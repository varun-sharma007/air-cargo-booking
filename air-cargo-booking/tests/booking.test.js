const request = require('supertest');
const app = require('../server');
const database = require('../src/config/database');
const redis = require('../src/config/redis');

describe('Booking API', () => {
  beforeAll(async () => {
    await database.initialize();
    await redis.connect();
  });

  afterAll(async () => {
    await database.close();
    await redis.disconnect();
  });

  beforeEach(async () => {
    // Clean up test data before each test
    await database.query('DELETE FROM timeline_events WHERE booking_id IN (SELECT id FROM bookings WHERE ref_id LIKE "TEST%")');
    await database.query('DELETE FROM booking_flights WHERE booking_id IN (SELECT id FROM bookings WHERE ref_id LIKE "TEST%")');
    await database.query('DELETE FROM bookings WHERE ref_id LIKE "TEST%"');
  });

  describe('POST /api/bookings', () => {
    test('should create a new booking successfully', async () => {
      const bookingData = {
        origin: 'DEL',
        destination: 'BLR',
        pieces: 5,
        weight_kg: 25
      };

      const response = await request(app)
        .post('/api/bookings')
        .send(bookingData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.ref_id).toMatch(/^AC[A-Z0-9]+$/);
    });

    test('should reject booking with same origin and destination', async () => {
      const bookingData = {
        origin: 'DEL',
        destination: 'DEL',
        pieces: 5,
        weight_kg: 25
      };

      const response = await request(app)
        .post('/api/bookings')
        .send(bookingData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('cannot be the same');
    });

    test('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/bookings')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Validation error');
    });
  });

  describe('GET /api/bookings/:refId', () => {
    let testBookingRefId;

    beforeEach(async () => {
      // Create a test booking
      const bookingData = {
        origin: 'DEL',
        destination: 'BLR',
        pieces: 5,
        weight_kg: 25
      };

      const response = await request(app)
        .post('/api/bookings')
        .send(bookingData);

      testBookingRefId = response.body.data.ref_id;
    });

    test('should retrieve booking details successfully', async () => {
      const response = await request(app)
        .get(`/api/bookings/${testBookingRefId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.ref_id).toBe(testBookingRefId);
      expect(response.body.data.origin).toBe('DEL');
      expect(response.body.data.destination).toBe('BLR');
      expect(response.body.data.timeline).toBeDefined();
    });

    test('should return 404 for non-existent booking', async () => {
      const response = await request(app)
        .get('/api/bookings/NONEXISTENT')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not found');
    });
  });

  describe('PATCH /api/bookings/:refId/status', () => {
    let testBookingRefId;

    beforeEach(async () => {
      const bookingData = {
        origin: 'DEL',
        destination: 'BLR',
        pieces: 5,
        weight_kg: 25
      };

      const response = await request(app)
        .post('/api/bookings')
        .send(bookingData);

      testBookingRefId = response.body.data.ref_id;
    });

    test('should update booking status successfully', async () => {
      const response = await request(app)
        .patch(`/api/bookings/${testBookingRefId}/status`)
        .send({
          status: 'DEPARTED',
          location: 'DEL',
          description: 'Test departure'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('DEPARTED');
    });

    test('should prevent cancelling arrived bookings', async () => {
      // First mark as arrived
      await request(app)
        .patch(`/api/bookings/${testBookingRefId}/status`)
        .send({ status: 'ARRIVED', location: 'BLR' });

      // Then try to cancel
      const response = await request(app)
        .patch(`/api/bookings/${testBookingRefId}/status`)
        .send({ status: 'CANCELLED' })
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Cannot cancel');
    });
  });
});
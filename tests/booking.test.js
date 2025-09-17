const request = require('supertest');
const app = require('../server');
const database = require('../src/config/database');
const redis = require('../src/config/redis');

describe('Booking API', () => {
  let authToken;
  let testUserId;

  beforeAll(async () => {
    await database.initialize();
    await redis.connect();

    // Clean up potential old test data
    await database.query('DELETE FROM users WHERE email = ?', ['testuser@example.com']);

    // Create a test user
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'testuser@example.com', password: 'password123' });

    // Log in to get the auth token for tests
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'testuser@example.com', password: 'password123' });
    
    authToken = loginRes.body.token;
    testUserId = loginRes.body.user.id;
  });

  afterAll(async () => {
    // Clean up test data after all tests
    await database.query('DELETE FROM users WHERE id = ?', [testUserId]);
    await database.close();
    await redis.disconnect();
  });

  beforeEach(async () => {
    // Clean up test bookings before each test
    await database.query('DELETE FROM timeline_events WHERE booking_id IN (SELECT id FROM bookings WHERE ref_id LIKE "TEST%")');
    await database.query('DELETE FROM booking_flights WHERE booking_id IN (SELECT id FROM bookings WHERE ref_id LIKE "TEST%")');
    await database.query('DELETE FROM bookings WHERE ref_id LIKE "TEST%"');
  });

  describe('POST /api/bookings', () => {
    test('should create a new booking successfully for an authenticated user', async () => {
      const bookingData = {
        origin: 'DEL',
        destination: 'BLR',
        pieces: 5,
        weight_kg: 25
      };

      const response = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${authToken}`)
        .send(bookingData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.ref_id).toMatch(/^AC[A-Z0-9]+$/);
    });

    test('should fail to create a booking without authentication', async () => {
        const bookingData = {
            origin: 'DEL',
            destination: 'BLR',
            pieces: 5,
            weight_kg: 25
        };

        const response = await request(app)
            .post('/api/bookings')
            .send(bookingData)
            .expect(401);

        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('Access denied');
    });
  });

  describe('GET /api/bookings/:refId', () => {
    let testBookingRefId;

    beforeEach(async () => {
      const bookingData = { origin: 'DEL', destination: 'BLR', pieces: 5, weight_kg: 25 };
      const response = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${authToken}`)
        .send(bookingData);
      testBookingRefId = response.body.data.ref_id;
    });

    test('should retrieve booking details successfully', async () => {
      const response = await request(app)
        .get(`/api/bookings/${testBookingRefId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.ref_id).toBe(testBookingRefId);
    });
  });
  
  describe('GET /api/bookings/my-bookings', () => {
      test('should retrieve bookings for the authenticated user', async () => {
          // Create a booking for the test user first
          await request(app)
            .post('/api/bookings')
            .set('Authorization', `Bearer ${authToken}`)
            .send({ origin: 'MAA', destination: 'CCU', pieces: 2, weight_kg: 10 });
            
          const response = await request(app)
            .get('/api/bookings/my-bookings')
            .set('Authorization', `Bearer ${authToken}`)
            .expect(200);
            
          expect(response.body.success).toBe(true);
          expect(Array.isArray(response.body.data)).toBe(true);
          expect(response.body.data.length).toBeGreaterThan(0);
          expect(response.body.data[0].user_id).toBe(testUserId);
      });

      test('should return 401 if not authenticated', async () => {
          await request(app)
            .get('/api/bookings/my-bookings')
            .expect(401);
      });
  });

});

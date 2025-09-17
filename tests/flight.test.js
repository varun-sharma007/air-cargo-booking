const request = require('supertest');
const app = require('../server');
const database = require('../src/config/database');
const redis = require('../src/config/redis');
const moment = require('moment');

describe('Flight API', () => {
  beforeAll(async () => {
    await database.initialize();
    await redis.connect();
  });

  afterAll(async () => {
    await database.close();
    await redis.disconnect();
  });

  beforeEach(async () => {
    await database.query('DELETE FROM booking_flights WHERE flight_id LIKE "TEST%"');
    await database.query('DELETE FROM flights WHERE flight_id LIKE "TEST%"');
  });

  describe('GET /api/flights/routes', () => {
    beforeEach(async () => {
      // Add test flights
      const tomorrow = moment().add(1, 'day');
      const testFlights = [
        {
          flight_id: 'TEST001_20241201',
          flight_number: 'TEST001',
          airline_name: 'Test Airlines',
          departure_datetime: tomorrow.clone().hour(10).format('YYYY-MM-DD HH:mm:ss'),
          arrival_datetime: tomorrow.clone().hour(12).format('YYYY-MM-DD HH:mm:ss'),
          origin: 'DEL',
          destination: 'BLR'
        },
        {
          flight_id: 'TEST002_20241201',
          flight_number: 'TEST002',
          airline_name: 'Test Airlines',
          departure_datetime: tomorrow.clone().hour(14).format('YYYY-MM-DD HH:mm:ss'),
          arrival_datetime: tomorrow.clone().hour(16).format('YYYY-MM-DD HH:mm:ss'),
          origin: 'DEL',
          destination: 'HYD'
        },
        {
          flight_id: 'TEST003_20241201',
          flight_number: 'TEST003',
          airline_name: 'Test Airlines',
          departure_datetime: tomorrow.clone().hour(17).format('YYYY-MM-DD HH:mm:ss'),
          arrival_datetime: tomorrow.clone().hour(19).format('YYYY-MM-DD HH:mm:ss'),
          origin: 'HYD',
          destination: 'BLR'
        }
      ];

      for (const flight of testFlights) {
        await database.query(`
          INSERT INTO flights (flight_id, flight_number, airline_name, departure_datetime, arrival_datetime, origin, destination)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          flight.flight_id,
          flight.flight_number,
          flight.airline_name,
          flight.departure_datetime,
          flight.arrival_datetime,
          flight.origin,
          flight.destination
        ]);
      }
    });

    test('should find direct routes', async () => {
      const tomorrow = moment().add(1, 'day').format('YYYY-MM-DD');
      
      const response = await request(app)
        .get('/api/flights/routes')
        .query({
          origin: 'DEL',
          destination: 'BLR',
          departure_date: tomorrow
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.routes.direct).toHaveLength(1);
      expect(response.body.data.routes.direct[0].flight_number).toBe('TEST001');
    });

    test('should find transit routes', async () => {
      const tomorrow = moment().add(1, 'day').format('YYYY-MM-DD');
      
      const response = await request(app)
        .get('/api/flights/routes')
        .query({
          origin: 'DEL',
          destination: 'BLR',
          departure_date: tomorrow
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.routes.transit.length).toBeGreaterThan(0);
      
      const transitRoute = response.body.data.routes.transit[0];
      expect(transitRoute.segments).toHaveLength(2);
      expect(transitRoute.transit_hub).toBe('HYD');
    });

    test('should validate required parameters', async () => {
      const response = await request(app)
        .get('/api/flights/routes')
        .query({ origin: 'DEL' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Validation error');
    });

    test('should reject same origin and destination', async () => {
      const tomorrow = moment().add(1, 'day').format('YYYY-MM-DD');
      
      const response = await request(app)
        .get('/api/flights/routes')
        .query({
          origin: 'DEL',
          destination: 'DEL',
          departure_date: tomorrow
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('cannot be the same');
    });
  });

  describe('POST /api/flights', () => {
    test('should add a new flight successfully', async () => {
      const tomorrow = moment().add(1, 'day');
      const flightData = {
        flight_id: 'TESTADD001',
        flight_number: 'TESTADD001',
        airline_name: 'Test Add Airlines',
        departure_datetime: tomorrow.hour(10).toISOString(),
        arrival_datetime: tomorrow.hour(12).toISOString(),
        origin: 'DEL',
        destination: 'BLR'
      };

      const response = await request(app)
        .post('/api/flights')
        .send(flightData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.flight_id).toBe(flightData.flight_id);
    });

    test('should validate flight data', async () => {
      const response = await request(app)
        .post('/api/flights')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Validation error');
    });

    test('should reject flights with same origin and destination', async () => {
      const tomorrow = moment().add(1, 'day');
      const flightData = {
        flight_id: 'TESTINVALID001',
        flight_number: 'TESTINVALID001',
        airline_name: 'Test Airlines',
        departure_datetime: tomorrow.hour(10).toISOString(),
        arrival_datetime: tomorrow.hour(12).toISOString(),
        origin: 'DEL',
        destination: 'DEL'
      };

      const response = await request(app)
        .post('/api/flights')
        .send(flightData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('cannot be the same');
    });
  });

  describe('GET /api/flights/:flight_id', () => {
    beforeEach(async () => {
      const tomorrow = moment().add(1, 'day');
      await database.query(`
        INSERT INTO flights (flight_id, flight_number, airline_name, departure_datetime, arrival_datetime, origin, destination)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        'TESTGET001',
        'TESTGET001',
        'Test Airlines',
        tomorrow.hour(10).format('YYYY-MM-DD HH:mm:ss'),
        tomorrow.hour(12).format('YYYY-MM-DD HH:mm:ss'),
        'DEL',
        'BLR'
      ]);
    });

    test('should retrieve flight details', async () => {
      const response = await request(app)
        .get('/api/flights/TESTGET001')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.flight_id).toBe('TESTGET001');
      expect(response.body.data.origin).toBe('DEL');
      expect(response.body.data.destination).toBe('BLR');
    });

    test('should return 404 for non-existent flight', async () => {
      const response = await request(app)
        .get('/api/flights/NONEXISTENT')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not found');
    });
  });
});
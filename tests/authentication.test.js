const request = require('supertest');
const app = require('../server');
const database = require('../src/config/database');
const bcrypt = require('bcryptjs');

describe('Auth API', () => {
    let testUser;

    beforeAll(async () => {
        await database.initialize();
        // Clean up before all tests run
        await database.query('DELETE FROM bookings WHERE user_id IN (SELECT id FROM users WHERE email LIKE "test.user%@example.com")');
        await database.query('DELETE FROM users WHERE email LIKE "test.user%@example.com"');
    });

    afterAll(async () => {
        // Final cleanup
        await database.query('DELETE FROM bookings WHERE user_id IN (SELECT id FROM users WHERE email LIKE "test.user%@example.com")');
        await database.query('DELETE FROM users WHERE email LIKE "test.user%@example.com"');
        await database.close();
    });

    describe('POST /api/auth/register', () => {
        it('should register a new user successfully', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'test.user@example.com',
                    password: 'password123',
                })
                .expect(201);
            
            expect(res.body.success).toBe(true);
            expect(res.body.message).toBe('User registered successfully!');
        });

        it('should fail to register a user with an existing email', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'test.user@example.com',
                    password: 'password123',
                })
                .expect(409);
            
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBe('User with this email already exists.');
        });
    });

    describe('POST /api/auth/login', () => {
        it('should log in an existing user and return a token', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'test.user@example.com',
                    password: 'password123',
                })
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(res.body.token).toBeDefined();
            expect(res.body.user).toBeDefined();
            expect(res.body.user.email).toBe('test.user@example.com');
        });

        it('should fail to log in with an incorrect password', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'test.user@example.com',
                    password: 'wrongpassword',
                })
                .expect(400);
            
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBe('Invalid credentials.');
        });
    });
});

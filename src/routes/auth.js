const express = require('express');
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const database = require('../config/database');
const logger = require('../utils/logger');
const router = express.Router();

// --- Validation Schemas ---
const authSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
});

// --- Validation Middleware ---
const validate = (schema) => (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
        return res.status(400).json({ success: false, error: error.details[0].message });
    }
    next();
};

// --- API Endpoints ---

// POST /api/auth/register
router.post('/register', validate(authSchema), async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const { rows } = await database.query('SELECT id FROM users WHERE email = ?', [email]);
        if (rows.length > 0) {
            return res.status(409).json({ success: false, error: 'Email already exists.' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        await database.query('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword]);
        res.status(201).json({ success: true, message: 'User registered successfully!' });
    } catch (error) {
        next(error);
    }
});

// POST /api/auth/login
router.post('/login', validate(authSchema), async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const { rows } = await database.query('SELECT * FROM users WHERE email = ?', [email]);
        if (rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Invalid email or password' });
        }
        const user = rows[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, error: 'Invalid email or password' });
        }
        const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
        
        // CORRECTED: The successful response is now wrapped in a "data" object for consistency.
        res.json({ 
            success: true, 
            data: {
                token, 
                email: user.email 
            }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;


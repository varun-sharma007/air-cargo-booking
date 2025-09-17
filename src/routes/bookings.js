const express = require('express');
const Joi = require('joi');
const bookingService = require('../config/services/bookingService');
const logger = require('../utils/logger');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// --- Validation Schemas ---
const createBookingSchema = Joi.object({
  origin: Joi.string().length(3).uppercase().required(),
  destination: Joi.string().length(3).uppercase().required(),
  pieces: Joi.number().integer().min(1).required(),
  weight_kg: Joi.number().min(1).required(),
  flight_ids: Joi.array().items(Joi.string()).optional().default([])
});

const updateStatusSchema = Joi.object({
  status: Joi.string().valid('DEPARTED', 'ARRIVED', 'DELIVERED', 'CANCELLED').required(),
  location: Joi.string().length(3).uppercase().optional(),
  description: Joi.string().max(500).optional().allow('')
});


// --- Validation Middleware ---
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body);
  if (error) {
    logger.warn('Validation error', { error: error.details[0].message, body: req.body });
    return res.status(400).json({ success: false, error: error.details[0].message });
  }
  req.body = value;
  next();
};

// --- API Endpoints ---
router.post('/', authMiddleware, validate(createBookingSchema), async (req, res, next) => {
  try {
    const { origin, destination, pieces, weight_kg, flight_ids } = req.body;
    if (origin === destination) {
      return res.status(400).json({ success: false, error: 'Origin and destination cannot be the same.' });
    }
    const bookingData = { origin, destination, pieces, weight_kg, userId: req.user.id };
    const newBooking = await bookingService.createBooking(bookingData, flight_ids);
    res.status(201).json({ success: true, data: newBooking });
  } catch (error) {
    next(error); 
  }
});

// ** THE FIX **
// Restore the missing PATCH route for status updates.
router.patch('/:refId/status', authMiddleware, validate(updateStatusSchema), async (req, res, next) => {
    try {
        const { refId } = req.params;
        const { status, location, description } = req.body;
        const updatedBooking = await bookingService.updateBookingStatus(refId, status, { location, description });
        res.json({ success: true, data: updatedBooking });
    } catch (error) {
        next(error);
    }
});

router.get('/admin/stats', async (req, res, next) => {
    try {
        const stats = await bookingService.getBookingStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }
});

// Get all bookings for the authenticated user
router.get('/', authMiddleware, async (req, res, next) => {
    try {
        const bookings = await bookingService.getBookingsByUserId(req.user.id);
        res.json({ success: true, data: bookings });
    } catch (error) {
        next(error);
    }
});

// Get a specific booking (with security check)
router.get('/:refId', authMiddleware, async (req, res, next) => {
  try {
    const booking = await bookingService.getBookingHistory(req.params.refId);
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }
    if (booking.user_id !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    res.json({ success: true, data: booking });
  } catch (error) {
    next(error);
  }
});

module.exports = router;


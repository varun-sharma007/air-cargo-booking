const express = require('express');
const Joi = require('joi');
console.log('Requiring bookingRoutes...');
const bookingService = require('../config/services/bookingService');
const logger = require('../utils/logger');

const router = express.Router();
// Validation schemas
const createBookingSchema = Joi.object({
  origin: Joi.string().length(3).uppercase().required(),
  destination: Joi.string().length(3).uppercase().required(),
  pieces: Joi.number().integer().min(1).max(1000).required(),
  weight_kg: Joi.number().integer().min(1).max(50000).required(),
  flight_ids: Joi.array().items(Joi.string()).optional()
});

const updateStatusSchema = Joi.object({
  status: Joi.string().valid('DEPARTED', 'ARRIVED', 'DELIVERED', 'CANCELLED').required(),
  location: Joi.string().length(3).uppercase().optional(),
  flight_id: Joi.string().optional(),
  description: Joi.string().max(500).optional()
});

const searchSchema = Joi.object({
  origin: Joi.string().length(3).uppercase().optional(),
  destination: Joi.string().length(3).uppercase().optional(),
  status: Joi.string().valid('BOOKED', 'DEPARTED', 'ARRIVED', 'DELIVERED', 'CANCELLED').optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50)
});

// Middleware for validation
const validate = (schema) => {
  return (req, res, next) => {
    const data = { ...req.body, ...req.query };
    const { error, value } = schema.validate(data, { abortEarly: false });

    if (error) {
      // Pass the validation error to the central error handler
      error.name = 'ValidationError'; // Ensures that the error handler identifies correctly
      return next(error);
    }
    req.validatedData = value;
    next();
  };
};

// Create new booking
router.post('/', validate(createBookingSchema), async (req, res, next) => {
  try {
    const { origin, destination, pieces, weight_kg, flight_ids = [] } = req.validatedData;

    // Business validation
    if (origin === destination) {
      return res.status(400).json({
        success: false,
        error: 'Origin and destination cannot be the same'
      });
    }

    const result = await bookingService.createBooking(
      { origin, destination, pieces, weight_kg },
      flight_ids
    );

    res.status(201).json({
      success: true,
      data: {
        ref_id: result.refId,
        message: 'Booking created successfully'
      }
    });

  } catch (error) {
    logger.error('Create booking error:', error);
    next(error);
  }
});

// Get booking history by ref_id
router.get('/:refId', async (req, res, next) => {
  try {
    const { refId } = req.params;
    
    // Basic ref_id validation
    if (!/^[A-Z0-9]{8,20}$/.test(refId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid reference ID format'
      });
    }

    const booking = await bookingService.getBookingHistory(refId);
    
    if (!booking) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }

    res.json({
      success: true,
      data: booking
    });

  } catch (error) {
    logger.error('Get booking error:', error);
    next(error);
  }
});

// Update booking status
router.patch('/:refId/status', validate(updateStatusSchema), async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { status, location, flight_id, description } = req.validatedData;

    if (!/^[A-Z0-9]{8,20}$/.test(refId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid reference ID format'
      });
    }

    const result = await bookingService.updateBookingStatus(
      refId, status, location, flight_id, description
    );

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
    
    if (error.message.includes('Cannot cancel') || error.message.includes('Concurrent update')) {
      return res.status(409).json({
        success: false,
        error: error.message
      });
    }
    
    logger.error('Update status error:', error);
    next(error);
  }
});

// Convenience endpoints for status updates
router.post('/:refId/depart', async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { location, flight_id, description } = req.body;

    const result = await bookingService.updateBookingStatus(
      refId, 'DEPARTED', location, flight_id, 
      description || `Departed from ${location || 'origin'}`
    );

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Depart booking error:', error);
    next(error);
  }
});

router.post('/:refId/arrive', async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { location, flight_id, description } = req.body;

    const result = await bookingService.updateBookingStatus(
      refId, 'ARRIVED', location, flight_id,
      description || `Arrived at ${location || 'destination'}`
    );

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Arrive booking error:', error);
    next(error);
  }
});

router.post('/:refId/deliver', async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { description } = req.body;

    const result = await bookingService.updateBookingStatus(
      refId, 'DELIVERED', null, null,
      description || 'Package delivered successfully'
    );

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Deliver booking error:', error);
    next(error);
  }
});

router.post('/:refId/cancel', async (req, res, next) => {
  try {
    const { refId } = req.params;
    const { description } = req.body;

    const result = await bookingService.updateBookingStatus(
      refId, 'CANCELLED', null, null,
      description || 'Booking cancelled'
    );

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Cancel booking error:', error);
    next(error);
  }
});

// Search bookings
router.get('/', validate(searchSchema), async (req, res, next) => {
  try {
    const { page, limit, ...filters } = req.validatedData;
    
    const result = await bookingService.searchBookings(filters, page, limit);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Search bookings error:', error);
    next(error);
  }
});

// Get booking statistics
router.get('/admin/stats', async (req, res, next) => {
  try {
    const stats = await bookingService.getBookingStats();

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    logger.error('Get booking stats error:', error);
    next(error);
  }
});

// Get performance metrics
router.get('/admin/metrics', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const metrics = await bookingService.getPerformanceMetrics(days);

    res.json({
      success: true,
      data: metrics
    });

  } catch (error) {
    logger.error('Get performance metrics error:', error);
    next(error);
  }
});

// Bulk operations
router.post('/bulk/update-status', async (req, res, next) => {
  try {
    const { ref_ids, status, location } = req.body;

    if (!Array.isArray(ref_ids) || ref_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'ref_ids must be a non-empty array'
      });
    }

    if (!['DEPARTED', 'ARRIVED', 'DELIVERED', 'CANCELLED'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status'
      });
    }

    const results = await bookingService.bulkUpdateStatus(ref_ids, status, location);

    res.json({
      success: true,
      data: {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        details: results
      }
    });

  } catch (error) {
    logger.error('Bulk update error:', error);
    next(error);
  }
});
module.exports = router;
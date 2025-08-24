const express = require('express');
const Joi = require('joi');
console.log('Requiring flightRoutes...');
const flightService = require('../config/services/flightService');
const logger = require('../utils/logger');
const moment = require('moment');

const router = express.Router();


// Validation schemas
const routeSearchSchema = Joi.object({
  origin: Joi.string().length(3).uppercase().required(),
  destination: Joi.string().length(3).uppercase().required(),
  departure_date: Joi.date().min('now').required()
});

const flightSearchSchema = Joi.object({
  origin: Joi.string().length(3).uppercase().optional(),
  destination: Joi.string().length(3).uppercase().optional(),
  airline_name: Joi.string().max(100).optional(),
  flight_number: Joi.string().max(20).optional(),
  departure_date_from: Joi.date().optional(),
  departure_date_to: Joi.date().optional(),
  include_past: Joi.boolean().default(false),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50)
});

const addFlightSchema = Joi.object({
  flight_id: Joi.string().max(50).required(),
  flight_number: Joi.string().max(20).required(),
  airline_name: Joi.string().max(100).required(),
  departure_datetime: Joi.date().min('now').required(),
  arrival_datetime: Joi.date().min(Joi.ref('departure_datetime')).required(),
  origin: Joi.string().length(3).uppercase().required(),
  destination: Joi.string().length(3).uppercase().required()
});

// Middleware for validation
const validate = (schema) => {
  return (req, res, next) => {
    const data = { ...req.body, ...req.query };
    const { error, value } = schema.validate(data, { abortEarly: false });

    if (error) {
      // Pass the validation error to the central error handler
      error.name = 'ValidationError'; // Ensure the error handler identifies it correctly
      return next(error);
    }

    req.validatedData = value;
    next();
  };
};

// Get routes (direct + transit) between two airports
router.get('/routes', validate(routeSearchSchema), async (req, res, next) => {
  try {
    const { origin, destination, departure_date } = req.validatedData;

    // Business validation
    if (origin === destination) {
      return res.status(400).json({
        success: false,
        error: 'Origin and destination cannot be the same'
      });
    }

    const routes = await flightService.getRoutes(origin, destination, departure_date);

    res.json({
      success: true,
      data: {
        origin,
        destination,
        departure_date: moment(departure_date).format('YYYY-MM-DD'),
        routes
      }
    });

  } catch (error) {
    logger.error('Get routes error:', error);
    next(error);
  }
});

// Get flight details by ID
router.get('/:flight_id', async (req, res, next) => {
  try {
    const { flight_id } = req.params;

    if (!flight_id || flight_id.length > 50) {
      return res.status(400).json({
        success: false,
        error: 'Invalid flight ID'
      });
    }

    const flight = await flightService.getFlightById(flight_id);

    if (!flight) {
      return res.status(404).json({
        success: false,
        error: 'Flight not found'
      });
    }

    res.json({
      success: true,
      data: flight
    });

  } catch (error) {
    logger.error('Get flight error:', error);
    next(error);
  }
});

// Search flights with filters
router.get('/', validate(flightSearchSchema), async (req, res, next) => {
  try {
    const { page, limit, ...filters } = req.validatedData;

    // Validate date range if both provided
    if (filters.departure_date_from && filters.departure_date_to) {
      if (moment(filters.departure_date_from).isAfter(filters.departure_date_to)) {
        return res.status(400).json({
          success: false,
          error: 'departure_date_from cannot be after departure_date_to'
        });
      }
    }

    const result = await flightService.searchFlights(filters, page, limit);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Search flights error:', error);
    next(error);
  }
});

// Get flight statistics
router.get('/admin/stats', async (req, res, next) => {
  try {
    const stats = await flightService.getFlightStatistics();

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    logger.error('Get flight stats error:', error);
    next(error);
  }
});

// Add new flight (admin endpoint)
router.post('/', validate(addFlightSchema), async (req, res, next) => {
  try {
    const flightData = req.validatedData;

    // Additional business validations
    if (flightData.origin === flightData.destination) {
      return res.status(400).json({
        success: false,
        error: 'Origin and destination cannot be the same'
      });
    }

    const duration = moment(flightData.arrival_datetime).diff(
      moment(flightData.departure_datetime),
      'hours'
    );

    if (duration > 24) {
      return res.status(400).json({
        success: false,
        error: 'Flight duration cannot exceed 24 hours'
      });
    }

    if (duration < 0.5) {
      return res.status(400).json({
        success: false,
        error: 'Flight duration must be at least 30 minutes'
      });
    }

    const result = await flightService.addFlight(flightData);

    res.status(201).json({
      success: true,
      data: result
    });

  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        error: 'Flight with this ID already exists'
      });
    }

    logger.error('Add flight error:', error);
    next(error);
  }
});

// Bulk add flights (admin endpoint)
router.post('/bulk', async (req, res, next) => {
  try {
    const { flights } = req.body;

    if (!Array.isArray(flights) || flights.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'flights must be a non-empty array'
      });
    }

    if (flights.length > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Cannot add more than 1000 flights at once'
      });
    }

    // Validate each flight
    for (const flight of flights) {
      const { error } = addFlightSchema.validate(flight);
      if (error) {
        return res.status(400).json({
          success: false,
          error: `Invalid flight data for ${flight.flight_id}: ${error.details[0].message}`
        });
      }
    }

    const results = await flightService.bulkAddFlights(flights);

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
    logger.error('Bulk add flights error:', error);
    next(error);
  }
});

// Get popular routes analytics
router.get('/analytics/routes', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const limit = parseInt(req.query.limit) || 20;

    const query = `
      SELECT
        CONCAT(origin, '-', destination) as route,
        origin,
        destination,
        COUNT(*) as flight_count,
        COUNT(DISTINCT airline_name) as airlines_serving,
        AVG(TIMESTAMPDIFF(MINUTE, departure_datetime, arrival_datetime)) as avg_duration_minutes,
        MIN(departure_datetime) as earliest_departure,
        MAX(departure_datetime) as latest_departure
      FROM flights
      WHERE departure_datetime >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND departure_datetime >= NOW()
      GROUP BY origin, destination
      ORDER BY flight_count DESC
      LIMIT ?
    `;

    const { rows } = await database.query(query, [days, limit]);

    const routes = rows.map(route => ({
      ...route,
      avg_duration_hours: Math.round(route.avg_duration_minutes / 60 * 100) / 100
    }));

    res.json({
      success: true,
      data: {
        period_days: days,
        routes
      }
    });

  } catch (error) {
    logger.error('Get route analytics error:', error);
    next(error);
  }
});

// Get airline performance
router.get('/analytics/airlines', async (req, res, next) => {
  try {
    const query = `
      SELECT
        airline_name,
        COUNT(*) as total_flights,
        COUNT(DISTINCT CONCAT(origin, '-', destination)) as routes_served,
        COUNT(DISTINCT origin) as origins_served,
        COUNT(DISTINCT destination) as destinations_served,
        AVG(TIMESTAMPDIFF(MINUTE, departure_datetime, arrival_datetime)) as avg_duration_minutes,
        MIN(departure_datetime) as earliest_flight,
        MAX(departure_datetime) as latest_flight
      FROM flights
      WHERE departure_datetime >= NOW()
      GROUP BY airline_name
      ORDER BY total_flights DESC
    `;

    const { rows } = await database.query(query);

    const airlines = rows.map(airline => ({
      ...airline,
      avg_duration_hours: Math.round(airline.avg_duration_minutes / 60 * 100) / 100,
      market_share: 0 // Will be calculated after getting total
    }));

    // Calculate market share
    const totalFlights = airlines.reduce((sum, airline) => sum + airline.total_flights, 0);
    airlines.forEach(airline => {
      airline.market_share = totalFlights > 0 ?
        Math.round((airline.total_flights / totalFlights) * 100 * 100) / 100 : 0;
    });

    res.json({
      success: true,
      data: {
        total_airlines: airlines.length,
        total_flights: totalFlights,
        airlines
      }
    });

  } catch (error) {
    logger.error('Get airline analytics error:', error);
    next(error);
  }
});

module.exports = router;
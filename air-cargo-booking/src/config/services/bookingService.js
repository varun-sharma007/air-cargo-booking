const database = require('../database');
const redis = require('../redis');
const logger = require('../../utils/logger');
const { v4: uuidv4 } = require('uuid');

class BookingService {
  
  // Generate human-friendly ref_id
  generateRefId() {
    const prefix = 'AC'; // Air Cargo
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substr(2, 4).toUpperCase();
    return `${prefix}${timestamp}${random}`;
  }

  async createBooking(bookingData, flightIds = []) {
    const lockKey = `create_booking_${Date.now()}`;
    const lockId = await redis.acquireLock(lockKey, 30);
    
    if (!lockId) {
      throw new Error('Unable to acquire lock for booking creation');
    }

    try {
      return await database.transaction(async (connection) => {
        const refId = this.generateRefId();
        
        // Insert booking
        const bookingQuery = `
          INSERT INTO bookings (ref_id, origin, destination, pieces, weight_kg, status)
          VALUES (?, ?, ?, ?, ?, 'BOOKED')
        `;
        
        const [bookingResult] = await connection.execute(bookingQuery, [
          refId,
          bookingData.origin,
          bookingData.destination,
          bookingData.pieces,
          bookingData.weight_kg
        ]);

        const bookingId = bookingResult.insertId;

        // Insert flight mappings if provided
        if (flightIds.length > 0) {
          for (let i = 0; i < flightIds.length; i++) {
            const flightMappingQuery = `
              INSERT INTO booking_flights (booking_id, flight_id, sequence_order)
              VALUES (?, ?, ?)
            `;
            await connection.execute(flightMappingQuery, [bookingId, flightIds[i], i + 1]);
          }
        }

        // Create initial timeline event
        const timelineQuery = `
          INSERT INTO timeline_events (booking_id, event_type, location, description)
          VALUES (?, 'BOOKED', ?, 'Booking created successfully')
        `;
        
        await connection.execute(timelineQuery, [bookingId, bookingData.origin]);

        // Log business event
        logger.businessEvent('BOOKING_CREATED', {
          refId,
          origin: bookingData.origin,
          destination: bookingData.destination,
          pieces: bookingData.pieces,
          weight: bookingData.weight_kg
        });

        return { refId, bookingId };
      });

    } finally {
      await redis.releaseLock(lockKey, lockId);
    }
  }

  async updateBookingStatus(refId, status, location = null, flightId = null, description = null) {
    const lockKey = `booking_${refId}`;
    const lockId = await redis.acquireLock(lockKey, 30);
    
    if (!lockId) {
      throw new Error('Unable to acquire lock for booking update');
    }

    try {
      return await database.transaction(async (connection) => {
        // Get current booking
        const [bookings] = await connection.execute(
          'SELECT id, status, version FROM bookings WHERE ref_id = ?',
          [refId]
        );

        if (bookings.length === 0) {
          throw new Error('Booking not found');
        }

        const booking = bookings[0];

        // Business rule: Cannot cancel if already arrived
        if (status === 'CANCELLED' && booking.status === 'ARRIVED') {
          throw new Error('Cannot cancel booking that has already arrived');
        }

        // Update booking status with optimistic locking
        const updateQuery = `
          UPDATE bookings 
          SET status = ?, version = version + 1 
          WHERE ref_id = ? AND version = ?
        `;
        
        const [updateResult] = await connection.execute(updateQuery, [
          status, refId, booking.version
        ]);

        if (updateResult.affectedRows === 0) {
          throw new Error('Concurrent update detected. Please retry.');
        }

        // Add timeline event
        const eventDescription = description || `Status updated to ${status}`;
        const timelineQuery = `
          INSERT INTO timeline_events (booking_id, event_type, location, flight_id, description)
          VALUES (?, ?, ?, ?, ?)
        `;
        
        await connection.execute(timelineQuery, [
          booking.id, status, location, flightId, eventDescription
        ]);

        // Invalidate cache
        await redis.invalidateBookingCache(refId);

        // Log business event
        logger.businessEvent('BOOKING_STATUS_UPDATED', {
          refId,
          oldStatus: booking.status,
          newStatus: status,
          location,
          flightId
        });

        return { success: true, refId, status };
      });

    } finally {
      await redis.releaseLock(lockKey, lockId);
    }
  }
  async getBookingHistory(refId) {
    // Try cache first
    const cached = await redis.getCachedBooking(refId);
    if (cached) {
        logger.cacheEvent('GET', `booking:${refId}`, true);
        return cached;
    }

    // Query 1: Get the core booking details
    const bookingQuery = `
      SELECT id, ref_id, origin, destination, pieces, weight_kg, status, created_at, updated_at
      FROM bookings
      WHERE ref_id = ?
    `;
    const { rows: bookingRows } = await database.query(bookingQuery, [refId]);

    if (bookingRows.length === 0) {
        return null;
    }
    const booking = bookingRows[0];
    const bookingId = booking.id;

    // Query 2: Get the flight sequence
    const flightsQuery = `
      SELECT flight_id, sequence_order
      FROM booking_flights
      WHERE booking_id = ?
      ORDER BY sequence_order ASC
    `;
    const { rows: flightRows } = await database.query(flightsQuery, [bookingId]);
    booking.flights = flightRows.map(row => ({
        flight_id: row.flight_id,
        sequence: row.sequence_order
    }));

    // Query 3: Get the timeline events
    const timelineQuery = `
      SELECT event_type, location, flight_id, description, created_at
      FROM timeline_events
      WHERE booking_id = ?
      ORDER BY created_at ASC
    `;
    const { rows: timelineRows } = await database.query(timelineQuery, [bookingId]);
    
    // The driver returns this as an object, but we need to stringify it for the frontend/cache
    booking.timeline = JSON.stringify(timelineRows);

    // Cache the result
    await redis.cacheBooking(refId, booking);
    logger.cacheEvent('SET', `booking:${refId}`, false);

    return booking;
  }

  async searchBookings(filters, page = 1, limit = 50) {
    const allowedFields = ['origin', 'destination', 'status'];
    const { whereClause, values } = database.buildSearchConditions(filters, allowedFields);
    
    const baseQuery = `
      SELECT 
        ref_id,
        origin,
        destination,
        pieces,
        weight_kg,
        status,
        created_at,
        updated_at
      FROM bookings
      ${whereClause}
      ORDER BY created_at DESC
    `;

    const paginatedQuery = database.buildPaginationQuery(baseQuery, page, limit);
    const { rows } = await database.query(paginatedQuery, values);

    // Get total count for pagination
    const countQuery = `SELECT COUNT(*) as total FROM bookings ${whereClause}`;
    const { rows: countRows } = await database.query(countQuery, values);
    const total = countRows[0].total;

    return {
      bookings: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  async getBookingStats() {
    const query = `
      SELECT 
        status,
        COUNT(*) as count,
        AVG(weight_kg) as avg_weight,
        SUM(pieces) as total_pieces
      FROM bookings
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY status
    `;

    const { rows } = await database.query(query);
    
    const stats = {
      total: 0,
      by_status: {},
      avg_weight: 0,
      total_pieces: 0
    };

    rows.forEach(row => {
      stats.total += row.count;
      stats.total_pieces += row.total_pieces;
      stats.by_status[row.status] = {
        count: row.count,
        avg_weight: parseFloat(row.avg_weight || 0)
      };
    });

    if (rows.length > 0) {
      const totalWeight = rows.reduce((sum, row) => sum + (row.avg_weight * row.count), 0);
      stats.avg_weight = totalWeight / stats.total;
    }

    return stats;
  }

  // Bulk operations for performance
  async bulkUpdateStatus(refIds, status, location = null) {
    if (!Array.isArray(refIds) || refIds.length === 0) {
      throw new Error('Invalid refIds array');
    }

    const results = [];
    const batchSize = 10; // Process in batches to avoid long-running transactions

    for (let i = 0; i < refIds.length; i += batchSize) {
      const batch = refIds.slice(i, i + batchSize);
      
      try {
        await database.transaction(async (connection) => {
          for (const refId of batch) {
            try {
              await this.updateBookingStatus(refId, status, location);
              results.push({ refId, success: true });
            } catch (error) {
              logger.error(`Bulk update failed for ${refId}:`, error);
              results.push({ refId, success: false, error: error.message });
            }
          }
        });
      } catch (error) {
        // Handle batch-level errors
        batch.forEach(refId => {
          results.push({ refId, success: false, error: error.message });
        });
      }
    }

    return results;
  }

  // Analytics method
  async getPerformanceMetrics(days = 7) {
    const query = `
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as bookings_created,
        AVG(weight_kg) as avg_weight,
        COUNT(CASE WHEN status = 'DELIVERED' THEN 1 END) as delivered_count,
        COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END) as cancelled_count
      FROM bookings
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `;

    const { rows } = await database.query(query, [days]);
    
    return rows.map(row => ({
      date: row.date,
      bookings_created: row.bookings_created,
      avg_weight: parseFloat(row.avg_weight || 0),
      delivered_count: row.delivered_count,
      cancelled_count: row.cancelled_count,
      delivery_rate: row.bookings_created > 0 ? 
        (row.delivered_count / row.bookings_created * 100).toFixed(2) : 0
    }));
  }
}

module.exports = new BookingService();

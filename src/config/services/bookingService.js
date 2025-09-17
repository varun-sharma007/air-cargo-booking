const database = require('../database');
const redis = require('../redis');
const logger = require('../../utils/logger');

class BookingService {

  generateRefId() {
    const prefix = 'AC';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substr(2, 5).toUpperCase();
    return `${prefix}${timestamp}${random}`;
  }

  async createBooking(bookingData, flightIds = []) {
    const { refId } = await database.transaction(async (connection) => {
      const newRefId = this.generateRefId();
      const bookingQuery = `
        INSERT INTO bookings (ref_id, user_id, origin, destination, pieces, weight_kg, status)
        VALUES (?, ?, ?, ?, ?, ?, 'BOOKED')
      `;
      const [bookingResult] = await connection.execute(bookingQuery, [
        newRefId, bookingData.userId, bookingData.origin,
        bookingData.destination, bookingData.pieces, bookingData.weight_kg
      ]);
      const bookingId = bookingResult.insertId;

      if (flightIds && flightIds.length > 0) {
        for (let i = 0; i < flightIds.length; i++) {
          const flightMappingQuery = `INSERT INTO booking_flights (booking_id, flight_id, sequence_order) VALUES (?, ?, ?)`;
          await connection.execute(flightMappingQuery, [bookingId, flightIds[i], i + 1]);
        }
      }

      const firstFlightId = (flightIds && flightIds.length > 0) ? flightIds[0] : null;
      const timelineQuery = `
        INSERT INTO timeline_events (booking_id, event_type, location, flight_id, description)
        VALUES (?, 'BOOKED', ?, ?, 'Booking created successfully')
      `;
      await connection.execute(timelineQuery, [bookingId, bookingData.origin, firstFlightId]);

      logger.businessEvent('BOOKING_CREATED', { refId: newRefId, bookingId });
      return { refId: newRefId };
    });
    
    const newBookingDetails = await this.getBookingHistory(refId, true);
    await redis.cacheBooking(refId, newBookingDetails);
    return newBookingDetails;
  }

  async updateBookingStatus(refId, status, details = {}) {
    // ** THE FIX **
    // Ensure 'location' has a default value of null if it is not provided.
    // This prevents 'undefined' from being passed to the database query.
    const { location = null, description } = details;

    await database.transaction(async (connection) => {
        // Get current booking to check business rules and for logging
        const [bookingRows] = await connection.execute('SELECT id, status FROM bookings WHERE ref_id = ?', [refId]);
        if (bookingRows.length === 0) throw new Error('Booking not found');
        const booking = bookingRows[0];

        // Business Rule Example: Cannot cancel a booking that has already been delivered.
        if (status === 'CANCELLED' && booking.status === 'DELIVERED') {
            throw new Error('Cannot cancel a delivered booking.');
        }

        // Update booking status
        const updateQuery = 'UPDATE bookings SET status = ? WHERE ref_id = ?';
        await connection.execute(updateQuery, [status, refId]);

        // Add timeline event
        const timelineQuery = `
            INSERT INTO timeline_events (booking_id, event_type, location, description)
            VALUES (?, ?, ?, ?)
        `;
        await connection.execute(timelineQuery, [booking.id, status, location, description || `Status updated to ${status}`]);

        logger.businessEvent('STATUS_UPDATED', { refId, oldStatus: booking.status, newStatus: status });
    });

    // Invalidate cache and return fresh data
    await redis.invalidateBookingCache(refId);
    return this.getBookingHistory(refId, true);
  }


    async getBookingsByUserId(userId) {
        const query = `
            SELECT ref_id, origin, destination, pieces, weight_kg, status, created_at
            FROM bookings
            WHERE user_id = ?
            ORDER BY created_at DESC
        `;
        const { rows } = await database.query(query, [userId]);
        return rows;
    }

    async getBookingHistory(refId, forceDb = false) {
        if (!forceDb) {
            const cached = await redis.getCachedBooking(refId);
            if (cached) return cached;
        }

        const bookingQuery = `SELECT * FROM bookings WHERE ref_id = ?`;
        const { rows: bookingRows } = await database.query(bookingQuery, [refId]);
        if (bookingRows.length === 0) return null;
        
        const booking = bookingRows[0];
        
        const flightsQuery = `
            SELECT bf.flight_id, bf.sequence_order, f.flight_number, f.airline_name
            FROM booking_flights bf JOIN flights f ON bf.flight_id = f.flight_id
            WHERE bf.booking_id = ? ORDER BY bf.sequence_order ASC
        `;
        const { rows: flightRows } = await database.query(flightsQuery, [booking.id]);
        booking.flights = flightRows;

        const timelineQuery = `SELECT * FROM timeline_events WHERE booking_id = ? ORDER BY created_at ASC, id ASC`;
        const { rows: timelineRows } = await database.query(timelineQuery, [booking.id]);
        booking.timeline = timelineRows;

        await redis.cacheBooking(refId, booking);
        return booking;
    }

    async getBookingStats() {
        const query = `
        SELECT 
            status,
            COUNT(*) as count
        FROM bookings
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY status
        `;
        const { rows } = await database.query(query);
        const stats = {
            total: 0,
            by_status: {},
        };
        rows.forEach(row => {
            stats.total += Number(row.count);
            stats.by_status[row.status] = {
                count: Number(row.count)
            };
        });
        return stats;
    }
}

module.exports = new BookingService();


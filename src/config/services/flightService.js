const database = require('../database');
const redis = require('../redis');
const logger = require('../../utils/logger');
const moment = require('moment');
class FlightService {

  async getRoutes(origin, destination, departureDate) {
    const dateStr = moment(departureDate).format('YYYY-MM-DD');
    
    // Check cache first
    const cached = await redis.getCachedFlightRoutes(origin, destination, dateStr);
    if (cached) {
      logger.cacheEvent('GET', `routes:${origin}:${destination}:${dateStr}`, true);
      return cached;
    }

    const routes = {
      direct: [],
      transit: []
    };

    try {
      // Get direct flights
      routes.direct = await this.getDirectFlights(origin, destination, departureDate);
      
      // Get one-stop transit routes
      routes.transit = await this.getTransitRoutes(origin, destination, departureDate);

      // Cache the results
      await redis.cacheFlightRoutes(origin, destination, dateStr, routes);
      logger.cacheEvent('SET', `routes:${origin}:${destination}:${dateStr}`, false);

      logger.info('Flight routes found', {
        origin,
        destination,
        date: dateStr,
        directCount: routes.direct.length,
        transitCount: routes.transit.length
      });

      return routes;

    } catch (error) {
      logger.error('Error finding routes:', error);
      throw error;
    }
  }

  async getDirectFlights(origin, destination, departureDate) {
    const startDate = moment(departureDate).startOf('day').format('YYYY-MM-DD HH:mm:ss');
    const endDate = moment(departureDate).endOf('day').format('YYYY-MM-DD HH:mm:ss');

    const query = `
      SELECT 
        flight_id,
        flight_number,
        airline_name,
        departure_datetime,
        arrival_datetime,
        origin,
        destination,
        TIMESTAMPDIFF(MINUTE, departure_datetime, arrival_datetime) as duration_minutes
      FROM flights
      WHERE origin = ? 
        AND destination = ?
        AND departure_datetime BETWEEN ? AND ?
        AND departure_datetime >= NOW()
      ORDER BY departure_datetime ASC
    `;

    const { rows } = await database.query(query, [
      origin, 
      destination, 
      startDate, 
      endDate
    ]);

    return rows.map(flight => ({
      ...flight,
      route_type: 'direct',
      total_duration_minutes: flight.duration_minutes,
      stops: 0
    }));
  }

  async getTransitRoutes(origin, destination, departureDate) {
    const startDate = moment(departureDate).startOf('day').format('YYYY-MM-DD HH:mm:ss');
    const endDate = moment(departureDate).endOf('day').format('YYYY-MM-DD HH:mm:ss');
    
    // Find connecting flights through intermediate airports
    const query = `
      SELECT 
        f1.flight_id as first_flight_id,
        f1.flight_number as first_flight_number,
        f1.airline_name as first_airline,
        f1.departure_datetime as first_departure,
        f1.arrival_datetime as first_arrival,
        f1.origin as first_origin,
        f1.destination as transit_hub,
        
        f2.flight_id as second_flight_id,
        f2.flight_number as second_flight_number,
        f2.airline_name as second_airline,
        f2.departure_datetime as second_departure,
        f2.arrival_datetime as second_arrival,
        f2.origin as second_origin,
        f2.destination as second_destination,
        
        TIMESTAMPDIFF(MINUTE, f1.departure_datetime, f2.arrival_datetime) as total_duration,
        TIMESTAMPDIFF(MINUTE, f1.arrival_datetime, f2.departure_datetime) as layover_minutes
        
      FROM flights f1
      JOIN flights f2 ON f1.destination = f2.origin
      
      WHERE f1.origin = ?
        AND f2.destination = ?
        AND f1.departure_datetime BETWEEN ? AND ?
        AND f1.departure_datetime >= NOW()
        
        -- Second flight should be same day or next day
        AND f2.departure_datetime <= DATE_ADD(f1.departure_datetime, INTERVAL 1 DAY)
        
        -- Minimum 1 hour layover, maximum 24 hours
        AND TIMESTAMPDIFF(MINUTE, f1.arrival_datetime, f2.departure_datetime) >= 60
        AND TIMESTAMPDIFF(MINUTE, f1.arrival_datetime, f2.departure_datetime) <= 1440
        
        -- Ensure connection is feasible (second flight departs after first arrives)
        AND f2.departure_datetime > f1.arrival_datetime
        
      ORDER BY total_duration ASC, f1.departure_datetime ASC
      LIMIT 50
    `;

    const { rows } = await database.query(query, [
      origin,
      destination,
      startDate,
      endDate
    ]);

    return rows.map(route => ({
      route_type: 'transit',
      total_duration_minutes: route.total_duration,
      layover_minutes: route.layover_minutes,
      stops: 1,
      transit_hub: route.transit_hub,
      segments: [
        {
          flight_id: route.first_flight_id,
          flight_number: route.first_flight_number,
          airline_name: route.first_airline,
          departure_datetime: route.first_departure,
          arrival_datetime: route.first_arrival,
          origin: route.first_origin,
          destination: route.transit_hub,
          segment_order: 1
        },
        {
          flight_id: route.second_flight_id,
          flight_number: route.second_flight_number,
          airline_name: route.second_airline,
          departure_datetime: route.second_departure,
          arrival_datetime: route.second_arrival,
          origin: route.second_origin,
          destination: route.second_destination,
          segment_order: 2
        }
      ]
    }));
  }

  async getFlightById(flightId) {
    const query = `
      SELECT 
        flight_id,
        flight_number,
        airline_name,
        departure_datetime,
        arrival_datetime,
        origin,
        destination,
        TIMESTAMPDIFF(MINUTE, departure_datetime, arrival_datetime) as duration_minutes
      FROM flights
      WHERE flight_id = ?
    `;

    const { rows } = await database.query(query, [flightId]);
    return rows.length > 0 ? rows[0] : null;
  }



































  async searchFlights(filters, page = 1, limit = 50) {
    const allowedFields = ['origin', 'destination', 'airline_name', 'flight_number'];
    const { whereClause, values } = database.buildSearchConditions(filters, allowedFields);
    
    let additionalConditions = [];
    
    // Date range filtering
    if (filters.departure_date_from) {
      additionalConditions.push('departure_datetime >= ?');
      values.push(moment(filters.departure_date_from).startOf('day').format('YYYY-MM-DD HH:mm:ss'));
    }
    
    if (filters.departure_date_to) {
      additionalConditions.push('departure_datetime <= ?');
      values.push(moment(filters.departure_date_to).endOf('day').format('YYYY-MM-DD HH:mm:ss'));
    }

    // Only show future flights by default
    if (!filters.include_past) {
      additionalConditions.push('departure_datetime >= NOW()');
    }

    // Combine conditions
    let finalWhereClause = whereClause;
    if (additionalConditions.length > 0) {
      if (finalWhereClause) {
        finalWhereClause += ' AND ' + additionalConditions.join(' AND ');
      } else {
        finalWhereClause = 'WHERE ' + additionalConditions.join(' AND ');
      }
    }

    const baseQuery = `
      SELECT 
        flight_id,
        flight_number,
        airline_name,
        departure_datetime,
        arrival_datetime,
        origin,
        destination,
        TIMESTAMPDIFF(MINUTE, departure_datetime, arrival_datetime) as duration_minutes
      FROM flights
      ${finalWhereClause}
      ORDER BY departure_datetime ASC
    `;
    const paginatedQuery = database.buildPaginationQuery(baseQuery, page, limit);
    const { rows } = await database.query(paginatedQuery, values);

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM flights ${finalWhereClause}`;
    const { rows: countRows } = await database.query(countQuery, values);
    const total = countRows[0].total;

    return {
      flights: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  async getFlightStatistics() {
    const queries = {
      totalFlights: 'SELECT COUNT(*) as count FROM flights WHERE departure_datetime >= NOW()',
      airlineStats: `
        SELECT 
          airline_name,
          COUNT(*) as flight_count,
          COUNT(DISTINCT origin) as origins_served,
          COUNT(DISTINCT destination) as destinations_served
        FROM flights 
        WHERE departure_datetime >= NOW()
        GROUP BY airline_name
        ORDER BY flight_count DESC
        LIMIT 10
      `,
      routeStats: `
        SELECT 
          CONCAT(origin, '-', destination) as route,
          COUNT(*) as frequency,
          COUNT(DISTINCT airline_name) as airlines_count,
          AVG(TIMESTAMPDIFF(MINUTE, departure_datetime, arrival_datetime)) as avg_duration
        FROM flights
        WHERE departure_datetime >= NOW()
        GROUP BY origin, destination
        ORDER BY frequency DESC
        LIMIT 20
      `,
      // FIX: Corrected the hubStats query to be compatible with ONLY_FULL_GROUP_BY
      hubStats: `
        SELECT 
          airport,
          SUM(total_flights) as total_flights,
          SUM(departures) as departures,
          SUM(arrivals) as arrivals
        FROM (
          SELECT 
            origin as airport,
            COUNT(*) as departures,
            0 as arrivals,
            COUNT(*) as total_flights
          FROM flights 
          WHERE departure_datetime >= NOW()
          GROUP BY origin
          
          UNION ALL
          
          SELECT 
            destination as airport,
            0 as departures,
            COUNT(*) as arrivals,
            COUNT(*) as total_flights
          FROM flights 
          WHERE departure_datetime >= NOW()
          GROUP BY destination
        ) combined
        GROUP BY airport
        ORDER BY total_flights DESC
        LIMIT 10
      `
    };

    const results = {};
    
    for (const [key, query] of Object.entries(queries)) {
      try {
        const { rows } = await database.query(query);
        results[key] = rows;
      } catch (error) {
        logger.error(`Error executing ${key} query:`, error);
        results[key] = [];
      }
    }

    return {
      total_flights: results.totalFlights[0]?.count || 0,
      top_airlines: results.airlineStats,
      popular_routes: results.routeStats.map(route => ({
        ...route,
        avg_duration_hours: Math.round(route.avg_duration / 60 * 100) / 100
      })),
      major_hubs: results.hubStats
    };
  }

  // Admin functions for managing flights
  async addFlight(flightData) {
    const query = `
      INSERT INTO flights (
        flight_id, flight_number, airline_name, 
        departure_datetime, arrival_datetime, origin, destination
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    try {
      await database.query(query, [
        flightData.flight_id,
        flightData.flight_number,
        flightData.airline_name,
        flightData.departure_datetime,
        flightData.arrival_datetime,
        flightData.origin,
        flightData.destination
      ]);

      logger.businessEvent('FLIGHT_ADDED', flightData);
      
      // Clear related route caches
      await this.clearRouteCache(flightData.origin, flightData.destination);
      
      return { success: true, flight_id: flightData.flight_id };
    } catch (error) {
      logger.error('Error adding flight:', error);
      throw error;
    }
  }

  async clearRouteCache(origin, destination) {
    // Clear cache for the next 7 days
    const promises = [];
    
    for (let i = 0; i < 7; i++) {
      const date = moment().add(i, 'days').format('YYYY-MM-DD');
      const cacheKey = `routes:${origin}:${destination}:${date}`;
      promises.push(redis.del(cacheKey));
      
      // Also clear reverse route
      const reverseCacheKey = `routes:${destination}:${origin}:${date}`;
      promises.push(redis.del(reverseCacheKey));
    }
    
    await Promise.all(promises);
  }

  // Bulk flight import for seeding
  async bulkAddFlights(flights) {
    const batchSize = 100;
    const results = [];

    for (let i = 0; i < flights.length; i += batchSize) {
      const batch = flights.slice(i, i + batchSize);
      
      try {
        await database.transaction(async (connection) => {
          const query = `
            INSERT INTO flights (
              flight_id, flight_number, airline_name,
              departure_datetime, arrival_datetime, origin, destination
            ) VALUES ?
          `;
          
          const values = batch.map(flight => [
            flight.flight_id,
            flight.flight_number,
            flight.airline_name,
            flight.departure_datetime,
            flight.arrival_datetime,
            flight.origin,
            flight.destination
          ]);

          await connection.query(query, [values]);
          results.push(...batch.map(f => ({ flight_id: f.flight_id, success: true })));
        });
      } catch (error) {
        logger.error(`Batch flight insert failed:`, error);
        batch.forEach(flight => {
          results.push({ flight_id: flight.flight_id, success: false, error: error.message });
        });
      }
    }

    return results;
  }
}

module.exports = new FlightService();

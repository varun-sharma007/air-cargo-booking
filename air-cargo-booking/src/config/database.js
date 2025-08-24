const mysql = require('mysql2/promise');
const logger = require('../utils/logger');

class Database {
  constructor() {
    this.pool = null;
  }

  async initialize() {
    try {
      this.pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'air_cargo',
        waitForConnections: true,
        connectionLimit: 20,
        queueLimit: 0,
        charset: 'utf8mb4',
        timezone: 'Z'
      });

      // Test connection
      const connection = await this.pool.getConnection();
      await connection.ping();
      connection.release();

      logger.info('Database pool initialized successfully');
    } catch (error) {
      logger.error('Database initialization error:', error);
      throw error;
    }
  }

  async query(sql, params = []) {
    if (!this.pool) {
      throw new Error('Database not initialized');
    }

    const start = Date.now();
    try {
      const [rows, fields] = await this.pool.execute(sql, params);
      const duration = Date.now() - start;
      
      if (duration > 1000) {
        logger.warn(`Slow query detected (${duration}ms):`, { sql, params });
      }
      
      return { rows, fields };
    } catch (error) {
      logger.error('Database query error:', { sql, params, error: error.message });
      throw error;
    }
  }

  async transaction(callback) {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      const result = await callback(connection);
      
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      logger.error('Transaction rollback:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      logger.info('Database pool closed');
    }
  }

  buildPaginationQuery(baseQuery, page = 1, limit = 50) {
    const offset = (page - 1) * limit;
    return `${baseQuery} LIMIT ${limit} OFFSET ${offset}`;
  }

  buildSearchConditions(searchParams, allowedFields) {
    const conditions = [];
    const values = [];

    for (const [field, value] of Object.entries(searchParams)) {
      if (allowedFields.includes(field) && value !== undefined && value !== '') {
        if (typeof value === 'string' && value.includes('%')) {
          conditions.push(`${field} LIKE ?`);
        } else {
          conditions.push(`${field} = ?`);
        }
        values.push(value);
      }
    }

    return {
      whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      values
    };
  }
}

const database = new Database();
module.exports = database;

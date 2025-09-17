const { createClient } = require('redis');
const logger = require('../utils/logger');

class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      this.client = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        socket: {
          connectTimeout: 10000,
          lazyConnect: true,
        },
      });

      this.client.on('error', (err) => {
        logger.error('Redis Client Error:', err);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        logger.info('Redis client connected');
        this.isConnected = true;
      });

      this.client.on('disconnect', () => {
        logger.warn('Redis client disconnected');
        this.isConnected = false;
      });

      await this.client.connect();
    } catch (error) {
      logger.error('Redis connection error:', error);
      throw error;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
      logger.info('Redis client disconnected');
    }
  }

  // Caching methods
  async set(key, value, expireSeconds = 3600) {
    if (!this.isConnected) return false;
    
    try {
      const serializedValue = JSON.stringify(value);
      await this.client.setEx(key, expireSeconds, serializedValue);
      return true;
    } catch (error) {
      logger.error('Redis set error:', error);
      return false;
    }
  }

  async get(key) {
    if (!this.isConnected) return null;
    
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Redis get error:', error);
      return null;
    }
  }

  async del(key) {
    if (!this.isConnected) return false;
    
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logger.error('Redis del error:', error);
      return false;
    }
  }

  // Distributed locking
  async acquireLock(lockKey, ttlSeconds = 30, identifier = null) {
    if (!this.isConnected) return null;
    
    const lockId = identifier || `${Date.now()}-${Math.random()}`;
    const lockValue = `${lockId}:${Date.now()}`;
    
    try {
      // Try to acquire lock with expiration
      const result = await this.client.set(
        `lock:${lockKey}`, 
        lockValue, 
        { PX: ttlSeconds * 1000, NX: true }
      );
      
      if (result === 'OK') {
        logger.debug(`Lock acquired: ${lockKey} by ${lockId}`);
        return lockId;
      }
      
      return null;
    } catch (error) {
      logger.error('Lock acquisition error:', error);
      return null;
    }
  }
  async releaseLock(lockKey, lockId) {
    if (!this.isConnected || !lockKey || !lockId) return false;
    
    try {
      // Lua script to ensure we only release our own lock
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
        else
            return 0
        end
      `;
      
      const currentLockValue = await this.client.get(`lock:${lockKey}`);
      if (currentLockValue && currentLockValue.startsWith(`${lockId}:`)) {
        const result = await this.client.eval(luaScript, {
            keys: [`lock:${lockKey}`],
            arguments: [currentLockValue],
        });
        
        if (result === 1) {
          logger.debug(`Lock released: ${lockKey} by ${lockId}`);
          return true;
        }
      }
      
      return false;
    } catch (error) {
      logger.error('Lock release error:', error);
      return false;
    }
  }
  // Rate limiting
  async incrementCounter(key, windowSeconds = 60) {
    if (!this.isConnected) return 0;
    
    try {
      const pipeline = this.client.multi();
      pipeline.incr(key);
      pipeline.expire(key, windowSeconds);
      
      const results = await pipeline.exec();
      return results[0];
    } catch (error) {
      logger.error('Counter increment error:', error);
      return 0;
    }
  }

  // Flight route caching
  async cacheFlightRoutes(origin, destination, date, routes) {
    const cacheKey = `routes:${origin}:${destination}:${date}`;
    return await this.set(cacheKey, routes, 1800); // 30 minutes cache
  }

  async getCachedFlightRoutes(origin, destination, date) {
    const cacheKey = `routes:${origin}:${destination}:${date}`;
    return await this.get(cacheKey);
  }

  // Booking cache
  async cacheBooking(refId, bookingData) {
    const cacheKey = `booking:${refId}`;
    return await this.set(cacheKey, bookingData, 600); // 10 minutes cache
  }

  async getCachedBooking(refId) {
    const cacheKey = `booking:${refId}`;
    return await this.get(cacheKey);
  }

  async invalidateBookingCache(refId) {
    const cacheKey = `booking:${refId}`;
    return await this.del(cacheKey);
  }
}

const redis = new RedisClient();

module.exports = redis;

const logger = require('../utils/logger');
const database = require('../config/database');

const performanceMiddleware = (req, res, next) => {
  const start = Date.now();
  
  // Track original methods
  const originalJson = res.json;
  const originalSend = res.send;
  
  // Override response methods to capture timing
  res.json = function(body) {
    const duration = Date.now() - start;
    logApiRequest(req, res, duration);
    recordMetrics(req, res, duration);
    return originalJson.call(this, body);
  };
  
  res.send = function(body) {
    const duration = Date.now() - start;
    logApiRequest(req, res, duration);
    recordMetrics(req, res, duration);
    return originalSend.call(this, body);
  };
  
  next();
};

function logApiRequest(req, res, duration) {
  logger.apiRequest(
    req.method,
    req.originalUrl,
    res.statusCode,
    duration,
    req.userId || null
  );
  
  // Alert on slow requests
  if (duration > 5000) {
    logger.performanceAlert('slow_request', duration, 5000);
  }
}

async function recordMetrics(req, res, duration) {
  try {
    // Record API metrics in database (fire and forget)
    setImmediate(async () => {
      try {
        const query = `
          INSERT INTO api_metrics (endpoint, method, response_time_ms, status_code)
          VALUES (?, ?, ?, ?)
        `;
        await database.query(query, [
          req.route ? req.route.path : req.path,
          req.method,
          duration,
          res.statusCode
        ]);
      } catch (error) {
        logger.error('Failed to record metrics:', error);
      }
    });
  } catch (error) {
    logger.error('Metrics recording error:', error);
  }
}

module.exports = performanceMiddleware;


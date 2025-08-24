const winston = require('winston');
const path = require('path');

// Create logs directory if it doesn't exist
const fs = require('fs');
const logDir = 'logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Custom format for logs
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    if (Object.keys(meta).length > 0) {
      log += ` | Meta: ${JSON.stringify(meta)}`;
    }
    
    if (stack) {
      log += `\nStack: ${stack}`;
    }
    
    return log;
  })
);

// Logger configuration
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { 
    service: 'air-cargo-api',
    version: process.env.npm_package_version || '1.0.0'
  },
  transports: [
    // Error logs
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    
    // Combined logs
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    
    // API access logs
    new winston.transports.File({
      filename: path.join(logDir, 'api-access.log'),
      level: 'http',
      maxsize: 5242880, // 5MB
      maxFiles: 3
    })
  ],
  
  // Handle exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({ 
      filename: path.join(logDir, 'exceptions.log') 
    })
  ],
  
  rejectionHandlers: [
    new winston.transports.File({ 
      filename: path.join(logDir, 'rejections.log') 
    })
  ]
});

// Add console transport for development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
      winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
        let log = `${timestamp} [${level}]: ${message}`;
        
        if (Object.keys(meta).length > 0) {
          log += ` ${JSON.stringify(meta)}`;
        }
        
        if (stack) {
          log += `\n${stack}`;
        }
        
        return log;
      })
    )
  }));
}

// Custom logging methods for different contexts
logger.apiRequest = (method, url, statusCode, responseTime, userId = null) => {
  logger.http('API Request', {
    method,
    url,
    statusCode,
    responseTime,
    userId,
    type: 'api_request'
  });
};

logger.businessEvent = (event, data) => {
  logger.info('Business Event', {
    event,
    data,
    type: 'business_event'
  });
};

logger.securityEvent = (event, data) => {
  logger.warn('Security Event', {
    event,
    data,
    type: 'security_event'
  });
};

logger.performanceAlert = (metric, value, threshold) => {
  logger.warn('Performance Alert', {
    metric,
    value,
    threshold,
    type: 'performance_alert'
  });
};

logger.databaseEvent = (query, duration, error = null) => {
  const logLevel = error ? 'error' : (duration > 1000 ? 'warn' : 'debug');
  
  logger.log(logLevel, 'Database Event', {
    query,
    duration,
    error: error ? error.message : null,
    type: 'database_event'
  });
};

logger.cacheEvent = (operation, key, hit = null) => {
  logger.debug('Cache Event', {
    operation,
    key,
    hit,
    type: 'cache_event'
  });
};

module.exports = logger;
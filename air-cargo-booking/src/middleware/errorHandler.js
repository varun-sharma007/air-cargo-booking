// src/middleware/errorHandler.js
const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  // Log the error
  logger.error('Request error:', {
    error: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    body: req.body,
    query: req.query,
    params: req.params,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Default error response
  let statusCode = 500;
  let message = 'Internal server error';
  let details = null;

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation error';
    details = err.details;
  } else if (err.code === 'ER_DUP_ENTRY') {
    statusCode = 409;
    message = 'Duplicate entry';
  } else if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    statusCode = 400;
    message = 'Referenced record not found';
  } else if (err.message.includes('not found')) {
    statusCode = 404;
    message = err.message;
  } else if (err.message.includes('Unable to acquire lock')) {
    statusCode = 423;
    message = 'Resource locked, please try again';
  } else if (err.message.includes('Concurrent update')) {
    statusCode = 409;
    message = 'Concurrent modification detected, please retry';
  }

  // Don't expose internal errors in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'Internal server error';
    details = null;
  } else if (process.env.NODE_ENV !== 'production') {
    details = {
      stack: err.stack,
      ...details
    };
  }

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(details && { details }),
    timestamp: new Date().toISOString(),
    request_id: req.id || 'unknown'
  });
};

module.exports = errorHandler;
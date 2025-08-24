console.log('Starting server.js...');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
console.log('Requiring logger...');
const logger = require('./src/utils/logger');
console.log('Requiring database...');
const database = require('./src/config/database');
console.log('Requiring redis...');
const redis = require('./src/config/redis');
console.log('Requiring middleware...');
const performanceMiddleware = require('./src/middleware/performance');
console.log('Requiring errorhandler...');
const errorHandler = require('./src/middleware/errorHandler');

// Import routes
const flightRoutes = require('./src/routes/flights');
const bookingRoutes = require('./src/routes/bookings');


const app = express();
const PORT = process.env.PORT || 3000;

// Security and performance middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": ["'self'", "'unsafe-inline'"],
      },
    },
  })
);
app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 1000, 
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Performance monitoring middleware
app.use(performanceMiddleware);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API routes
app.use('/api/flights', flightRoutes);
app.use('/api/bookings', bookingRoutes);

// Serve static files for frontend
app.use(express.static('public'));

// Error handling middleware
app.use(errorHandler);

// Initialize connections and start server
async function startServer() {
  console.log('Starting startServer function...');
  try {
    // Initialize database connection
    await database.initialize();
    logger.info('Database connection established');

    // Initialize Redis connection
    await redis.connect();
    logger.info('Redis connection established');

    app.listen(PORT, () => {
      logger.info(`Air Cargo API server running on port ${PORT}`);
      logger.info(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

//shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  try {
    await database.close();
    await redis.disconnect();
    logger.info('All connections closed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  try {
    await database.close();
    await redis.disconnect();
    logger.info('All connections closed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

if (require.main === module) {
  startServer();
}

module.exports = app;

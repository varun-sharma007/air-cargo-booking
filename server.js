const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const logger = require('./src/utils/logger');
const database = require('./src/config/database');
const redis = require('./src/config/redis');
const errorHandler = require('./src/middleware/errorHandler');

// Import routes
const authRoutes = require('./src/routes/auth');
const flightRoutes = require('./src/routes/flights');
const bookingRoutes = require('./src/routes/bookings');

const app = express();
const PORT = process.env.PORT || 3000;

function setupApp() {
    logger.info('Setting up Express application...');
    
    // Security and performance middleware
    app.use(helmet());
    app.use(compression());
    
    // In production, only allow your actual frontend to make requests.
    // For local development, it will still allow localhost.
    const corsOptions = {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      credentials: true
    };
    app.use(cors(corsOptions));
    
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, 
      max: 1000, 
      message: 'Too many requests from this IP, please try again later.'
    });
    app.use('/api', limiter);

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Serve the frontend static files
    app.use(express.static('public'));

    // API routes
    logger.info('Registering API routes...');
    app.use('/api/auth', authRoutes);
    app.use('/api/flights', flightRoutes);
    app.use('/api/bookings', bookingRoutes);

    // Error handling middleware
    app.use(errorHandler);

    // Handle requests that don't match any route by sending the main frontend page.
    // This is important for single-page applications.
    app.get('*', (req, res) => {
        res.sendFile('index.html', { root: 'public' });
    });
}

async function startServer() {
    try {
        await database.initialize();
        await redis.connect();
        
        setupApp();

        app.listen(PORT, () => {
            logger.info(`Air Cargo API server running on port ${PORT}`);
            logger.info(`Access the application at http://localhost:${PORT}`);
        });

    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();


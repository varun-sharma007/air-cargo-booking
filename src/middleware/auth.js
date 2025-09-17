const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const database = require('../config/database'); // Import database

const authMiddleware = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) {
            logger.securityEvent('AUTH_FAILURE', { reason: 'No token provided', ip: req.ip });
            return res.status(401).json({ success: false, error: 'Access denied. No token provided.' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // ** THE FIX **
        // After verifying the token, ensure the user still exists in the database.
        // This prevents issues with stale tokens after a database reset.
        const { rows } = await database.query('SELECT id, email FROM users WHERE id = ?', [decoded.id]);
        
        if (rows.length === 0) {
            logger.securityEvent('AUTH_FAILURE', { reason: 'User not found in DB', tokenId: decoded.id, ip: req.ip });
            return res.status(401).json({ success: false, error: 'Invalid token. User not found.' });
        }

        req.user = rows[0]; // Attach the actual user object from DB to the request
        next();

    } catch (error) {
        // This will catch expired tokens, malformed tokens, etc.
        logger.securityEvent('AUTH_FAILURE', { reason: 'Invalid token signature or format', ip: req.ip });
        return res.status(401).json({ success: false, error: 'Invalid token.' });
    }
};

module.exports = authMiddleware;


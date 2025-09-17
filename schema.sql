-- Air Cargo Database Schema
CREATE DATABASE IF NOT EXISTS air_cargo;
USE air_cargo;

-- Drop tables in reverse order of dependency to avoid foreign key errors
DROP TABLE IF EXISTS `api_metrics`;
DROP TABLE IF EXISTS `timeline_events`;
DROP TABLE IF EXISTS `booking_flights`;
DROP TABLE IF EXISTS `bookings`;
DROP TABLE IF EXISTS `flights`;
DROP TABLE IF EXISTS `users`;

-- Users table
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Flights table
CREATE TABLE flights (
    flight_id VARCHAR(50) PRIMARY KEY,
    flight_number VARCHAR(20) NOT NULL,
    airline_name VARCHAR(100) NOT NULL,
    departure_datetime DATETIME NOT NULL,
    arrival_datetime DATETIME NOT NULL,
    origin VARCHAR(10) NOT NULL,
    destination VARCHAR(10) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_route_date (origin, destination, departure_datetime),
    INDEX idx_departure_date (departure_datetime)
);

-- Bookings table
CREATE TABLE bookings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL, -- CORRECTED: user_id is now required.
    ref_id VARCHAR(20) UNIQUE NOT NULL,
    origin VARCHAR(10) NOT NULL,
    destination VARCHAR(10) NOT NULL,
    pieces INT NOT NULL,
    weight_kg INT NOT NULL,
    status ENUM('BOOKED', 'DEPARTED', 'ARRIVED', 'DELIVERED', 'CANCELLED') DEFAULT 'BOOKED',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT DEFAULT 1,
    INDEX idx_ref_id (ref_id),
    INDEX idx_status (status),
    INDEX idx_user_id (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE -- CORRECTED: Changed to ON DELETE CASCADE
);

-- Booking flights mapping (for multi-hop routes)
CREATE TABLE booking_flights (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    booking_id BIGINT NOT NULL,
    flight_id VARCHAR(50) NOT NULL,
    sequence_order INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (flight_id) REFERENCES flights(flight_id),
    UNIQUE KEY unique_booking_flight (booking_id, flight_id)
);

-- Timeline events for tracking
CREATE TABLE timeline_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    booking_id BIGINT NOT NULL,
    event_type ENUM('BOOKED', 'DEPARTED', 'ARRIVED', 'DELIVERED', 'CANCELLED') NOT NULL,
    location VARCHAR(10),
    flight_id VARCHAR(50) NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    INDEX idx_booking_timeline (booking_id, created_at)
);

-- Performance monitoring table
CREATE TABLE api_metrics (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    endpoint VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    response_time_ms INT NOT NULL,
    status_code INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_endpoint_time (endpoint, created_at)
);


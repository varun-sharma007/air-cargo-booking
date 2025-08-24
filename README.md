# Air Cargo Booking & Tracking System

This is a full-stack web application designed to handle the booking and tracking of air cargo shipments. The system features a Node.js/Express backend, a MySQL database, a Redis cache for performance optimization, and a clean, user-friendly frontend built with vanilla JavaScript.

Features

•	Route Finding: Search for direct and 1-stop transit flight routes between an origin and destination.

•	Booking Creation: Create new cargo bookings with details like weight, number of pieces, and selected flights.

•	Real-Time Tracking: Track the status of a booking using a unique reference ID.

•	Status Updates: Mark bookings as Departed, Arrived, Delivered, or Cancelled.

•	Concurrency Handling: Uses Redis distributed locks to safely handle simultaneous updates to the same booking.

•	Performance Optimized: Leverages Redis caching for frequently accessed data and database indexing for fast queries.

•	API Monitoring: Basic performance metrics for API endpoints are logged to the database.

Tech Stack

•	Backend: Node.js, Express.js

•	Database: MySQL

•	Cache: Redis

•	Frontend: HTML, Tailwind CSS, Vanilla JavaScript

•	Testing: Jest, Supertest

•	Logging: Winston

Prerequisites
Before you begin, ensure you have the following installed on your local machine:

•	Node.js (v14 or later)

•	MySql Server

•	Redis Server

## Setup and Installation

Follow these steps to get the application running locally.

1. Clone the Repository
   
   git clone <https://github.com/varun-sharma007/air-cargo-booking.git>

   cd air-cargo-booking

2. Install Dependencies
   npm install

3. Configure Environment Variables
   
   Create a .env file in the root of the project. You can copy the example below. This project is configured to work with these default values, so you likely won't need to change them if your local MySQL/Redis setup is standard.
   
#Server Configuration

PORT=3000

#Database Configuration

DB_HOST=localhost

DB_PORT=3306

DB_USER=root

DB_PASSWORD=your_mysql_password # Change this to your MySQL root password

DB_NAME=air_cargo

#Redis Configuration

REDIS_URL=redis://localhost:6379
4. Setup the Database Make sure your MySQL server is running.
   
a. Create the Database: Log in to MySQL and create the database.

mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS air_cargo;"

b. Create the Tables: Run the schema script to create all necessary tables. You will be prompted for your MySQL password.

mysql -u root -p air_cargo < schema.sql

c. Seed the Database: Run the seed script to populate the database with sample flights and bookings.

npm run seed

Running the Application

1. Start the Server To run the server with automatic reloading on file changes (recommended for development):
   
   npm run dev

To run the server in production mode:
   npm start

The server will be running at http://localhost:3000.

2. Access the Application Open your web browser and navigate to: http://localhost:3000
   
3. Running Tests To run the automated tests for the API endpoints:
   
   npm test

## API Endpoints

The primary API endpoints are:

•	GET /api/flights/routes: Find flight routes.

•	POST /api/bookings: Create a new booking.

•	GET /api/bookings/:refId: Get the history and status of a booking


•	PATCH /api/bookings/:refId/status: Update the status of a booking.


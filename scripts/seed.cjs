const mysql = require('mysql2/promise');
const moment = require('moment');
const { createClient } = require('redis');
require('dotenv').config();

// --- CONFIGURATION ---
const FLIGHTS_TO_GENERATE = 5000;
const DAYS_IN_FUTURE = 45;
const BOOKINGS_TO_GENERATE = 200;
const USERS_TO_GENERATE = 10;
// --- END CONFIGURATION ---

const airports = [
  'DEL', 'BLR', 'BOM', 'MAA', 'HYD', 'CCU', 'AMD', 'COK', 'GOI', 'PNQ',
  'JAI', 'LKO', 'IXC', 'GAU', 'IXB', 'VNS', 'IXA', 'TRV', 'CJB', 'IXR'
];

const airlines = [
  'IndiGo', 'Air India', 'SpiceJet', 'GoAir', 'Vistara',
  'AirAsia India', 'Alliance Air', 'TruJet', 'Blue Dart', 'Air India Express'
];

async function seedDatabase() {
  let connection;
  let redisClient;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'air_cargo',
      multipleStatements: true
    });
    console.log('✅ Connected to MySQL database.');

    redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await redisClient.connect();
    console.log('✅ Connected to Redis.');
    
    console.log('🌱 Starting database seeding...');

    console.log('🗑️ Clearing existing data...');
    const schema = require('fs').readFileSync('./schema.sql', 'utf8');
    await connection.query(schema);
    console.log('✅ Database schema reset.');

    await redisClient.flushAll();
    console.log('✅ Redis cache cleared.');

    console.log(`👤 Generating ${USERS_TO_GENERATE} users...`);
    await generateUsers(USERS_TO_GENERATE, connection);
    console.log(`✅ Generated ${USERS_TO_GENERATE} users.`);
    
    console.log(`📅 Generating ${FLIGHTS_TO_GENERATE} flights...`);
    const flights = generateFlights(FLIGHTS_TO_GENERATE);
    await bulkInsertFlights(flights, connection);
    console.log(`✅ Generated ${FLIGHTS_TO_GENERATE} flights.`);

    console.log(`📦 Generating ${BOOKINGS_TO_GENERATE} sample bookings...`);
    await generateBookings(BOOKINGS_TO_GENERATE, connection);
    console.log(`✅ Generated ${BOOKINGS_TO_GENERATE} bookings.`);

    console.log('🎉 Database seeding completed successfully!');
    
    await printSummary(connection);

  } catch (error) {
    console.error('❌ Seeding failed:', error);
  } finally {
    if (connection) await connection.end();
    if (redisClient) await redisClient.quit();
  }
}

// ** THE FIX **
// This function is updated to guarantee unique flight IDs.
function generateFlights(count) {
  const flights = [];
  const generatedFlightIds = new Set(); // Use a Set for efficient uniqueness checking

  // Loop until we have the desired number of unique flights
  while (flights.length < count) { 
    const origin = getRandomElement(airports);
    let destination = getRandomElement(airports);
    while (destination === origin) {
      destination = getRandomElement(airports);
    }
    const airline = getRandomElement(airlines);
    const flightNumber = `${getAirlineCode(airline)}${1000 + Math.floor(Math.random() * 9000)}`;
    const departureDate = moment().add(Math.floor(Math.random() * DAYS_IN_FUTURE), 'days');
    departureDate.hour(Math.floor(Math.random() * 24)).minute([0, 15, 30, 45][Math.floor(Math.random() * 4)]);
    
    const flight_id = `${flightNumber}_${departureDate.format('YYYYMMDD')}`;

    // If we've already generated this ID, skip this iteration and try again.
    if (generatedFlightIds.has(flight_id)) {
      continue; 
    }
    generatedFlightIds.add(flight_id);

    const durationMinutes = 60 + Math.floor(Math.random() * 240);
    const arrivalDate = departureDate.clone().add(durationMinutes, 'minutes');

    flights.push({
      flight_id: flight_id,
      flight_number: flightNumber,
      airline_name: airline,
      departure_datetime: departureDate.format('YYYY-MM-DD HH:mm:ss'),
      arrival_datetime: arrivalDate.format('YYYY-MM-DD HH:mm:ss'),
      origin,
      destination
    });
  }
  return flights;
}

async function bulkInsertFlights(flights, connection) {
    const batchSize = 500;
    for (let i = 0; i < flights.length; i += batchSize) {
        const batch = flights.slice(i, i + batchSize);
        const query = `
            INSERT INTO flights (flight_id, flight_number, airline_name, departure_datetime, arrival_datetime, origin, destination)
            VALUES ?
        `;
        const values = batch.map(f => [f.flight_id, f.flight_number, f.airline_name, f.departure_datetime, f.arrival_datetime, f.origin, f.destination]);
        await connection.query(query, [values]);
    }
}


async function generateUsers(count, connection) {
    const bcrypt = require('bcryptjs');
    const users = [];
    const passwordHash = await bcrypt.hash('password123', 10);
    for (let i = 1; i <= count; i++) {
        users.push([`user${i}@example.com`, passwordHash]);
    }
    const myPasswordHash = await bcrypt.hash('@Shanks003', 10);
    users.push(['varunvasist2005@gmail.com', myPasswordHash]);

    const query = 'INSERT INTO users (email, password) VALUES ?';
    await connection.query(query, [users]);
}


async function generateBookings(count, connection) {
  const [users] = await connection.execute('SELECT id FROM users');
  const [flights] = await connection.execute('SELECT flight_id, origin, destination FROM flights');
  
  for (let i = 0; i < count; i++) {
    const user = getRandomElement(users);
    const flight = getRandomElement(flights);
    const pieces = 1 + Math.floor(Math.random() * 10);
    const weight = pieces * (5 + Math.floor(Math.random() * 50));
    const refId = generateRefId();
    
    const bookingQuery = `
      INSERT INTO bookings (ref_id, user_id, origin, destination, pieces, weight_kg, status)
      VALUES (?, ?, ?, ?, ?, ?, 'BOOKED')
    `;
    const [result] = await connection.execute(bookingQuery, [refId, user.id, flight.origin, flight.destination, pieces, weight]);
    const bookingId = result.insertId;

    const flightMappingQuery = `INSERT INTO booking_flights (booking_id, flight_id, sequence_order) VALUES (?, ?, 1)`;
    await connection.execute(flightMappingQuery, [bookingId, flight.flight_id]);

    const timelineQuery = `
      INSERT INTO timeline_events (booking_id, event_type, location, flight_id, description)
      VALUES (?, 'BOOKED', ?, ?, 'Booking created successfully')
    `;
    await connection.execute(timelineQuery, [bookingId, flight.origin, flight.flight_id]);
  }
}

function getAirlineCode(airlineName) {
  const codes = {
    'IndiGo': '6E', 'Air India': 'AI', 'SpiceJet': 'SG', 'GoAir': 'G8', 'Vistara': 'UK',
    'AirAsia India': 'I5', 'Alliance Air': '9I', 'TruJet': '2T', 'Blue Dart': 'BZ', 'Air India Express': 'IX'
  };
  return codes[airlineName] || 'XX';
}

function generateRefId() {
  const prefix = 'AC';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substr(2, 5).toUpperCase();
  return `${prefix}${timestamp}${random}`;
}

function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

async function printSummary(connection) {
  console.log('\n📊 Database Summary:');
  const [[flightCount]] = await connection.execute('SELECT COUNT(*) as count FROM flights');
  const [[bookingCount]] = await connection.execute('SELECT COUNT(*) as count FROM bookings');
  const [[userCount]] = await connection.execute('SELECT COUNT(*) as count FROM users');
  
  console.log(`   - ✈️  Total Flights: ${flightCount.count}`);
  console.log(`   - 📦 Total Bookings: ${bookingCount.count}`);
  console.log(`   - 👤 Total Users: ${userCount.count}`);
}

if (require.main === module) {
  (async () => {
    await seedDatabase();
  })();
}

module.exports = { seedDatabase };


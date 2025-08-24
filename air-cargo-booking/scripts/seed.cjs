const mysql = require('mysql2/promise');
const moment = require('moment');
require('dotenv').config();

// Airport codes for major Indian cities
const airports = [
  'DEL', 'BLR', 'BOM', 'MAA', 'HYD', 'CCU', 'AMD', 'COK', 'GOI', 'PNQ',
  'JAI', 'LKO', 'IXC', 'GAU', 'IXB', 'VNS', 'IXA', 'TRV', 'CJB', 'IXR'
];

// Airlines data
const airlines = [
  'IndiGo', 'Air India', 'SpiceJet', 'GoAir', 'Vistara',
  'AirAsia India', 'Alliance Air', 'TruJet', 'Blue Dart', 'Air India Express'
];

async function seedDatabase() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'air_cargo'
    });

    console.log('🌱 Starting database seeding...');

    // Clear existing data
    await connection.execute('DELETE FROM timeline_events');
    await connection.execute('DELETE FROM booking_flights');
    await connection.execute('DELETE FROM bookings');
    await connection.execute('DELETE FROM flights');
    console.log('✅ Cleared existing data');

    // Generate flights
    console.log('📅 Generating flights...');
    const flights = generateFlights(5000);
    
    // Batch insert flights
    const batchSize = 100;
    for (let i = 0; i < flights.length; i += batchSize) {
      const batch = flights.slice(i, i + batchSize);
      const query = `
        INSERT INTO flights (flight_id, flight_number, airline_name, departure_datetime, arrival_datetime, origin, destination)
        VALUES ?
      `;
      
      const values = batch.map(flight => [
        flight.flight_id, flight.flight_number, flight.airline_name,
        flight.departure_datetime, flight.arrival_datetime,
        flight.origin, flight.destination
      ]);

      await connection.query(query, [values]);
    }
    console.log(`✅ Generated ${flights.length} flights`);

    // Generate sample bookings
    console.log('📦 Generating sample bookings...');
    await generateBookings(200, connection);
    console.log(`✅ Generated 200 bookings`);

    console.log('🎉 Database seeding completed successfully!');
    
    // Print summary
    await printSummary(connection);

  } catch (error) {
    console.error('❌ Seeding failed:', error);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

function generateFlights(count) {
  const flights = [];
  const flightNumberCounters = {};

  for (let i = 0; i < count; i++) {
    const origin = getRandomElement(airports);
    let destination = getRandomElement(airports);
    
    while (destination === origin) {
      destination = getRandomElement(airports);
    }

    const airline = getRandomElement(airlines);
    
    const airlineCode = getAirlineCode(airline);
    if (!flightNumberCounters[airlineCode]) {
      flightNumberCounters[airlineCode] = 1000;
    }
    const flightNumber = `${airlineCode}${flightNumberCounters[airlineCode]++}`;

    const departureDate = moment().add(Math.floor(Math.random() * 30), 'days');
    const departureHour = Math.floor(Math.random() * 24);
    const departureMinute = Math.floor(Math.random() * 60);
    departureDate.hour(departureHour).minute(departureMinute).second(0);

    const durationMinutes = 30 + Math.floor(Math.random() * 210);
    const arrivalDate = departureDate.clone().add(durationMinutes, 'minutes');

    flights.push({
      flight_id: `${flightNumber}_${departureDate.format('YYYYMMDD')}`,
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

function getAirlineCode(airlineName) {
  const codes = {
    'IndiGo': '6E', 'Air India': 'AI', 'SpiceJet': 'SG', 'GoAir': 'G8', 'Vistara': 'UK',
    'AirAsia India': 'I5', 'Alliance Air': '9I', 'TruJet': '2T', 'Blue Dart': 'BZ', 'Air India Express': 'IX'
  };
  return codes[airlineName] || 'XX';
}

async function generateBookings(count, connection) {
  const bookings = [];
  const statuses = ['BOOKED', 'DEPARTED', 'ARRIVED', 'DELIVERED', 'CANCELLED'];
  const statusWeights = [30, 25, 20, 20, 5];

  for (let i = 0; i < count; i++) {
    const origin = getRandomElement(airports);
    let destination = getRandomElement(airports);
    
    while (destination === origin) {
      destination = getRandomElement(airports);
    }

    const pieces = 1 + Math.floor(Math.random() * 10);
    const weight = pieces * (5 + Math.floor(Math.random() * 50));
    const status = getWeightedRandomStatus(statuses, statusWeights);
    
    const refId = generateRefId();

    const bookingQuery = `
      INSERT INTO bookings (ref_id, origin, destination, pieces, weight_kg, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    
    const createdAt = moment().subtract(Math.floor(Math.random() * 30), 'days').format('YYYY-MM-DD HH:mm:ss');
    
    const [result] = await connection.execute(bookingQuery, [
      refId, origin, destination, pieces, weight, status, createdAt
    ]);

    const bookingId = result.insertId;
    await createTimelineEvents(bookingId, status, origin, destination, createdAt, connection);
  }
}

async function createTimelineEvents(bookingId, finalStatus, origin, destination, createdAt, connection) {
  const events = [{
    event_type: 'BOOKED', location: origin, description: 'Booking created successfully', created_at: createdAt
  }];

  const baseTime = moment(createdAt);
  
  if (['DEPARTED', 'ARRIVED', 'DELIVERED'].includes(finalStatus)) {
    events.push({
      event_type: 'DEPARTED', location: origin, description: `Departed from ${origin}`,
      created_at: baseTime.clone().add(Math.floor(Math.random() * 24), 'hours').format('YYYY-MM-DD HH:mm:ss')
    });
  }

  if (['ARRIVED', 'DELIVERED'].includes(finalStatus)) {
    events.push({
      event_type: 'ARRIVED', location: destination, description: `Arrived at ${destination}`,
      created_at: baseTime.clone().add(24 + Math.floor(Math.random() * 48), 'hours').format('YYYY-MM-DD HH:mm:ss')
    });
  }

  if (finalStatus === 'DELIVERED') {
    events.push({
      event_type: 'DELIVERED', location: destination, description: 'Package delivered successfully',
      created_at: baseTime.clone().add(72 + Math.floor(Math.random() * 24), 'hours').format('YYYY-MM-DD HH:mm:ss')
    });
  }

  if (finalStatus === 'CANCELLED') {
    events.push({
      event_type: 'CANCELLED', location: origin, description: 'Booking cancelled by customer',
      created_at: baseTime.clone().add(Math.floor(Math.random() * 12), 'hours').format('YYYY-MM-DD HH:mm:ss')
    });
  }

  for (const event of events) {
    const query = `
      INSERT INTO timeline_events (booking_id, event_type, location, description, created_at)
      VALUES (?, ?, ?, ?, ?)
    `;
    await connection.execute(query, [
      bookingId, event.event_type, event.location, event.description, event.created_at
    ]);
  }
}

function generateRefId() {
  const prefix = 'AC';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substr(2, 4).toUpperCase();
  return `${prefix}${timestamp}${random}`;
}

function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function getWeightedRandomStatus(statuses, weights) {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const random = Math.random() * totalWeight;
  
  let currentWeight = 0;
  for (let i = 0; i < statuses.length; i++) {
    currentWeight += weights[i];
    if (random <= currentWeight) {
      return statuses[i];
    }
  }
  return statuses[0];
}

async function printSummary(connection) {
  console.log('\n📊 Database Summary:');
  console.log('==================');
  
  const [flightCount] = await connection.execute('SELECT COUNT(*) as count FROM flights');
  console.log(`✈️  Total Flights: ${flightCount[0].count}`);
  
  const [airlineStats] = await connection.execute(`SELECT airline_name, COUNT(*) as count FROM flights GROUP BY airline_name ORDER BY count DESC`);
  console.log('\n🏢 Flights by Airline:');
  airlineStats.forEach(stat => console.log(`   ${stat.airline_name}: ${stat.count}`));
  
  const [bookingCount] = await connection.execute('SELECT COUNT(*) as count FROM bookings');
  console.log(`\n📦 Total Bookings: ${bookingCount[0].count}`);
  
  const [statusStats] = await connection.execute(`SELECT status, COUNT(*) as count FROM bookings GROUP BY status ORDER BY count DESC`);
  console.log('\n📈 Bookings by Status:');
  statusStats.forEach(stat => console.log(`   ${stat.status}: ${stat.count}`));
  
  const [routeStats] = await connection.execute(`SELECT CONCAT(origin, ' → ', destination) as route, COUNT(*) as count FROM flights GROUP BY origin, destination ORDER BY count DESC LIMIT 10`);
  console.log('\n🛣️  Top Routes:');
  routeStats.forEach(stat => console.log(`   ${stat.route}: ${stat.count} flights`));
}

// Run seeding if called directly
if (require.main === module) {
  (async () => {
    await seedDatabase();
  })();
}

module.exports = { seedDatabase };
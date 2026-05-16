const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  user: 'resimyhome',
  password: '6/DWlUC=ehZ',
  database: 'resimyhome',
};

async function setup() {
  let connection;
  try {
    console.log('Connecting to remote database...');
    connection = await mysql.createConnection(config);
    console.log('Connected!');

    const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    // Split schema into individual queries
    // Removing CREATE DATABASE and USE statements to use the provided DB
    const queries = schemaSql
      .split(';')
      .map(q => q.trim())
      .filter(q => q.length > 0 && !q.startsWith('CREATE DATABASE') && !q.startsWith('USE'));

    console.log(`Executing ${queries.length} schema queries...`);
    for (let query of queries) {
      await connection.query(query);
    }
    console.log('Schema created successfully!');

    // Insert Dummy Data
    console.log('Inserting dummy data...');
    const dummyQueries = [
      "SET FOREIGN_KEY_CHECKS = 0",
      "TRUNCATE TABLE users",
      "TRUNCATE TABLE vehicles",
      "TRUNCATE TABLE service_requests",
      "SET FOREIGN_KEY_CHECKS = 1",
      "INSERT INTO users (name, phone, password_hash, role, account_status, flat_number) VALUES ('Super Admin', '9999999999', '1234', 'super_admin', 'active', NULL)",
      "INSERT INTO users (name, phone, password_hash, role, account_status, flat_number) VALUES ('Manager Sahab', '8888888888', '1234', 'manager', 'active', NULL)",
      "INSERT INTO users (name, phone, password_hash, role, account_status, flat_number) VALUES ('Security Guard 1', '7777777777', '1234', 'guard', 'active', NULL)",
      "INSERT INTO users (name, phone, password_hash, role, account_status, flat_number) VALUES ('Suresh Plumber', '6666666666', '1234', 'technician', 'active', NULL)",
      "INSERT INTO users (name, phone, password_hash, role, account_status, flat_number) VALUES ('Rahul Resident', '9876543210', '1234', 'resident_primary', 'active', 'A-402')",
      "INSERT INTO users (name, phone, password_hash, role, account_status, flat_number) VALUES ('Priya Family', '9876500001', '1234', 'resident_family', 'active', 'A-402')",
      "INSERT INTO vehicles (user_id, vehicle_number, type, brand, status) VALUES (5, 'MH 12 AB 1234', 'Car / SUV (4-Wheeler)', 'Hyundai', 'Inside')",
      "INSERT INTO vehicles (user_id, vehicle_number, type, brand, status) VALUES (5, 'MH 12 CD 5678', 'Bike / Scooter (2-Wheeler)', 'Royal Enfield', 'Outside')",
      "INSERT INTO service_requests (user_id, category, description, status) VALUES (5, 'Plumber', 'Kitchen mein pipe leak ho rahi hai', 'Open')",
      "INSERT INTO service_requests (user_id, category, description, status) VALUES (5, 'Electrician', 'Hall ka fan slow chal raha hai', 'In-progress')"
    ];

    for (let dQuery of dummyQueries) {
      await connection.query(dQuery);
    }
    console.log('Dummy data inserted successfully!');

  } catch (err) {
    console.error('Database Setup Error:', err);
  } finally {
    if (connection) await connection.end();
  }
}

setup();

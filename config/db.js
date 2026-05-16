const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'resimyhome',
  password: process.env.DB_PASSWORD || '6/DWlUC=ehZ',
  database: process.env.DB_NAME || 'resimyhome',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;

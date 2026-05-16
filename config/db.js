const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'u684520259_resimyhome',
  password: process.env.DB_PASSWORD || '6/DWlUC=ehZ',
  database: process.env.DB_NAME || 'u684520259_resimyhome',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;

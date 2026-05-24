const mysql = require('mysql2/promise');
require('dotenv').config();

const config = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

console.log('Testing connection to DB:', config.host, 'user:', config.user);
mysql.createConnection(config)
  .then(conn => {
    console.log('SUCCESS: Connection works!');
    conn.end();
    process.exit(0);
  })
  .catch(err => {
    console.error('FAILURE: Connection failed!');
    console.error(err);
    process.exit(1);
  });

const mysql = require('mysql2/promise');
const config = {
  host: 'localhost',
  user: 'u684520259_resimyhome',
  password: '6/DWlUC=ehZ',
  database: 'u684520259_resimyhome',
};

async function check() {
  let conn;
  try {
    conn = await mysql.createConnection(config);
    const [rows] = await conn.query('DESCRIBE users');
    console.log("SUCCESS! Connected to local DB:");
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error("FAILED to connect to local DB:", err.message);
  } finally {
    if (conn) await conn.end();
  }
}
check();

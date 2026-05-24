const mysql = require('mysql2/promise');
const config = {
  host: 'yellowgreen-goldfish-813322.hostingersite.com',
  user: 'u684520259_resimyhome',
  password: '6/DWlUC=ehZ',
  database: 'u684520259_resimyhome',
};

async function check() {
  let conn;
  try {
    conn = await mysql.createConnection(config);
    const [rows] = await conn.query('DESCRIBE users');
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    if (conn) await conn.end();
  }
}
check();

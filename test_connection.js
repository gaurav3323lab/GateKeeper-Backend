const mysql = require('mysql2/promise');

const config = {
  host: 'yellowgreen-goldfish-813322.hostingersite.com',
  user: 'u684520259_resimyhome',
  password: '6/DWlUC=ehZ',
  database: 'u684520259_resimyhome',
};

console.log('Testing remote connection to yellowgreen-goldfish-813322.hostingersite.com...');
mysql.createConnection(config)
  .then(conn => {
    console.log('SUCCESS: Remote DB Connection works!');
    conn.end();
    process.exit(0);
  })
  .catch(err => {
    console.error('FAILURE: Remote DB Connection failed!');
    console.error(err);
    process.exit(1);
  });

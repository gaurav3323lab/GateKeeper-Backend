const http = require('https');

http.get('https://yellowgreen-goldfish-813322.hostingersite.com/api/auth/test-resident-logs', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log('Status Code:', res.statusCode);
    console.log('Response Body:', data);
  });
}).on('error', (err) => {
  console.error('Error:', err.message);
});

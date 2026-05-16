const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Socket.io — Real-time event hub
io.on('connection', (socket) => {
  console.log(`[Socket] User connected: ${socket.id}`);

  // Join role-based rooms
  socket.on('join_room', (data) => {
    socket.join(data.room);
    console.log(`[Socket] ${socket.id} joined room: ${data.room}`);
  });

  // SOS Emergency — Resident triggers
  socket.on('trigger_sos', (data) => {
    console.log('[Socket] SOS Triggered:', data);
    io.to('guard_room').to('manager_room').emit('sos_alert', {
      message: `🚨 EMERGENCY SOS from Flat ${data.flat_number} — ${data.user_name}`,
      flat_number: data.flat_number,
      user_name: data.user_name,
      userId: data.user_id,
      timestamp: new Date()
    });
  });

  // Visitor arrival at gate — Guard notifies resident
  socket.on('visitor_arrival', (data) => {
    console.log('[Socket] Visitor Arrival:', data);
    io.to(`flat_${data.flat_number}`).emit('visitor_notification', data);
  });

  // Visitor decision (approve/deny) — Resident notifies guard
  socket.on('visitor_decision', (data) => {
    console.log('[Socket] Visitor Decision:', data);
    io.to('guard_room').emit('visitor_decision_result', data);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] User disconnected: ${socket.id}`);
  });
});

// Make io accessible to routes
app.set('io', io);

// Health check
app.get('/', (req, res) => {
  res.send('✅ Resident Management API is running...');
});

// Import Cron Jobs
require('./cron/dataCleanup');

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/manager', require('./routes/manager'));
app.use('/api/entry', require('./routes/entry'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/service', require('./routes/service'));
app.use('/api/family', require('./routes/family'));
app.use('/api/societies', require('./routes/societies'));
app.use('/api/guard', require('./routes/guard'));
app.use('/api/announcements', require('./routes/announcements'));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

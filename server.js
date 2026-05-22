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
app.use(cors()); // Standard CORS helper

// Bulletproof custom CORS & preflight manual middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

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
app.use('/api/admin', require('./routes/admin'));
app.use('/api/manager', require('./routes/manager'));
app.use('/api/entry', require('./routes/entry'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/service', require('./routes/service'));
app.use('/api/family', require('./routes/family'));
app.use('/api/societies', require('./routes/societies'));
app.use('/api/guard', require('./routes/guard'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/ads', require('./routes/ads'));
app.use('/api/push', require('./routes/push'));
app.use('/api/community', require('./routes/community'));

// ── Auto-Migration on Startup ─────────────────────────────────
// Nayi tables automatically create ho jayengi agar exist nahi karti
// Hostinger par manual migration ki zaroorat nahi padegi
const db = require('./config/db');
async function autoMigrate() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        user_id    INT  NOT NULL,
        endpoint   TEXT NULL,
        p256dh     TEXT NULL,
        auth       TEXT NULL,
        fcm_token  VARCHAR(255) NULL UNIQUE,
        platform   VARCHAR(50) DEFAULT 'web',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Dynamic upgrades for pre-existing push_subscriptions table
    try {
      await db.execute('ALTER TABLE push_subscriptions MODIFY COLUMN endpoint TEXT NULL');
      await db.execute('ALTER TABLE push_subscriptions MODIFY COLUMN p256dh TEXT NULL');
      await db.execute('ALTER TABLE push_subscriptions MODIFY COLUMN auth TEXT NULL');
    } catch (e) { /* ignore modification errors if already modified */ }

    try {
      await db.execute('ALTER TABLE push_subscriptions ADD COLUMN fcm_token VARCHAR(255) NULL UNIQUE');
      console.log('✅ Auto-migration: Added fcm_token column successfully.');
    } catch (e) { /* ignore if column already exists */ }

    try {
      await db.execute('ALTER TABLE push_subscriptions ADD COLUMN platform VARCHAR(50) DEFAULT "web"');
      console.log('✅ Auto-migration: Added platform column successfully.');
    } catch (e) { /* ignore if column already exists */ }

    await db.execute(`
      CREATE TABLE IF NOT EXISTS emergency_contacts (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        society_id INT NOT NULL,
        name       VARCHAR(100) NOT NULL,
        phone      VARCHAR(20)  NOT NULL,
        category   VARCHAR(50)  NOT NULL DEFAULT 'Other',
        priority   INT          NOT NULL DEFAULT 5,
        created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE
      )
    `);
    
    // Create new community tables
    await db.execute(`
      CREATE TABLE IF NOT EXISTS community_posts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        society_id INT NOT NULL,
        author_id INT NOT NULL,
        type VARCHAR(20) DEFAULT 'post',
        title VARCHAR(255) NOT NULL,
        body TEXT NULL,
        poll_options TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE,
        FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS community_likes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        post_id INT NOT NULL,
        user_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_post_user (post_id, user_id),
        FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS community_comments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        post_id INT NOT NULL,
        author_id INT NOT NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
        FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS community_poll_votes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        post_id INT NOT NULL,
        user_id INT NOT NULL,
        selected_option VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_post_user_vote (post_id, user_id),
        FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS home_chores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        society_id INT NOT NULL,
        flat_number VARCHAR(50) NOT NULL,
        text VARCHAR(255) NOT NULL,
        is_done BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE
      )
    `);

    // Dynamic Seed: If community_posts is empty, insert the default active poll!
    const [postsCount] = await db.execute('SELECT COUNT(*) AS cnt FROM community_posts');
    if (postsCount[0].cnt === 0) {
      const [users] = await db.execute('SELECT id, society_id FROM users LIMIT 1');
      if (users.length > 0) {
        const authorId = users[0].id;
        const societyId = users[0].society_id || 1;
        
        const pollOptions = JSON.stringify([
          "Owners Only",
          "Tenants & Family Members",
          "All registered flat members"
        ]);
        
        const [pollResult] = await db.execute(`
          INSERT INTO community_posts (society_id, author_id, type, title, body, poll_options)
          VALUES (?, ?, 'poll', 'Who should be allowed to vote for social issues in society? 🗳️', 'Opinion poll regarding voting guidelines.', ?)
        `, [societyId, authorId, pollOptions]);
        
        const pollPostId = pollResult.insertId;

        await db.execute(`
          INSERT INTO community_comments (post_id, author_id, text)
          VALUES (?, ?, 'I have 3 passes left, let me know if you want them!')
        `, [pollPostId, authorId]);

        const [allUsers] = await db.execute('SELECT id FROM users LIMIT 10');
        const options = ["Owners Only", "Tenants & Family Members", "All registered flat members"];
        for (let i = 0; i < allUsers.length; i++) {
          try {
            await db.execute(`
              INSERT INTO community_poll_votes (post_id, user_id, selected_option)
              VALUES (?, ?, ?)
            `, [pollPostId, allUsers[i].id, options[i % options.length]]);
          } catch (e) {}
        }
      }
    }
    
    // Prune duplicate active check-ins (keeping only the oldest) to clean up database state
    try {
      const [pruned] = await db.execute(`
        DELETE e1 FROM entry_logs e1
        INNER JOIN entry_logs e2 
        ON e1.entity_type = e2.entity_type 
        AND e1.entity_id = e2.entity_id 
        AND e1.exit_time IS NULL 
        AND e2.exit_time IS NULL
        AND e1.id > e2.id
      `);
      if (pruned.affectedRows > 0) {
        console.log(`[Auto-Migration] Cleaned up ${pruned.affectedRows} duplicate checked-in entry_logs!`);
      }
    } catch (e) {
      console.warn('⚠️  Auto-migration duplicate log prune warning:', e.message);
    }

    console.log('✅ Auto-migration complete: push_subscriptions, emergency_contacts + community tables ready.');
  } catch (err) {
    // Migration fail hone par sirf log karein, server band mat karein
    console.error('⚠️  Auto-migration warning (non-fatal):', err.message);
  }
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await autoMigrate();
});

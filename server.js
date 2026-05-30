const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');

const db = require('./config/db');
const { setIO, sendPushToFlat } = require('./utils/sendPush');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Echo the requesting origin dynamically to allow credentials bypass
      callback(null, origin || '*');
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  }
});

// Inject io into sendPush.js so push notifications can emit socket events
setIO(io);

// Middleware

// Bulletproof custom CORS & preflight manual middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
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
  socket.on('join_room', async (data) => {
    socket.join(data.room);
    console.log(`[Socket] ${socket.id} joined room: ${data.room}`);
    
    if (data.room === 'guard_room' && data.userId) {
      socket.userId = data.userId;
      socket.role = 'guard';
      try {
        await db.execute('UPDATE users SET is_online = TRUE WHERE id = ?', [data.userId]);
        console.log(`[Socket] Guard ${data.userId} is now ONLINE`);
        io.emit('guards_status_update');
      } catch (err) {
        console.error('Failed to mark guard online:', err.message);
      }
    }
    // Admin also joins manager_room so they receive approval requests & SOS alerts
    if (data.room === 'manager_room' && data.userId) {
      socket.join('manager_room');
    }
    // Every user joins their personal room for vehicle/account-level notifications
    if (data.userId) {
      socket.join(`user_${data.userId}`);
      console.log(`[Socket] ${socket.id} joined personal room: user_${data.userId}`);
    }
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
  socket.on('visitor_arrival', async (data) => {
    console.log('[Socket] Visitor Arrival:', data);
    
    // Resolve society_id
    let societyId = data.society_id || null;
    
    // Fetch society_id from guard's DB entry using socket.userId if not provided
    if (!societyId && socket.userId) {
      try {
        const [gRows] = await db.execute('SELECT society_id FROM users WHERE id = ?', [socket.userId]);
        if (gRows.length > 0) {
          societyId = gRows[0].society_id;
        }
      } catch (err) {
        console.error('Failed to fetch society_id for guard socket:', err.message);
      }
    }
    
    // Fallback to society_id = 1
    if (!societyId) {
      societyId = 1;
    }

    let guestId = null;
    let residentSocietyId = societyId;

    try {
      // 1. Find resident host_id matching tower, flat number, and society_id
      const [users] = await db.execute(
        `SELECT id, society_id FROM users 
         WHERE COALESCE(tower, '') = CAST(? AS CHAR) 
           AND flat_number = ? 
           AND role IN ('resident_primary', 'resident_family')
           AND society_id = ? 
         LIMIT 1`,
        [data.tower || '', data.flat_number, societyId]
      );
      
      const hostId = users.length > 0 ? users[0].id : null;
      if (users.length > 0) {
        residentSocietyId = users[0].society_id;
      }

      // 2. Insert into guests table with approval_status = 'pending'
      const [guestResult] = await db.execute(
        `INSERT INTO guests (name, phone, purpose, host_id, qr_code, valid_from, valid_to, approval_status)
         VALUES (?, ?, ?, ?, CONCAT('manual_', UNIX_TIMESTAMP()), NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY), 'pending')`,
        [data.name, data.phone || 'N/A', data.purpose || 'Walk-in', hostId]
      );
      guestId = guestResult.insertId;
    } catch (dbErr) {
      console.error('Failed to create guest record in visitor_arrival:', dbErr.message);
    }

    const payload = {
      guest_id: guestId,
      name: data.name,
      phone: data.phone || null,
      purpose: data.purpose || 'Guest',
      flat_number: data.flat_number,
      tower: data.tower || null,
      society_id: residentSocietyId
    };

    // Emit real-time Socket event to isolated flat room (with society_id prefix)
    const roomName = `society_${residentSocietyId}_flat_${data.tower ? data.tower + '-' : ''}${data.flat_number}`;
    io.to(roomName).emit('visitor_notification', payload);

    // Call sendPushToFlat to trigger high-priority background FCM call alert!
    try {
      await sendPushToFlat(
        data.tower,
        data.flat_number,
        `🚪 Visitor Aaya!`,
        `${data.name} gate par hain. Purpose: ${data.purpose || 'Guest'} — Tap karke approve/deny karein`,
        { 
          url: guestId ? `/?pending_visitor=${guestId}` : `/?visitor_name=${data.name}`, 
          type: 'visitor', 
          flat_number: data.flat_number, 
          society_id: residentSocietyId, 
          guest_id: guestId, 
          visitor_name: data.name, 
          purpose: data.purpose || 'Guest' 
        }
      );
      console.log(`[Socket] Push sent to flat for visitor arrival: ${data.name}`);
    } catch (pushErr) {
      console.error('Failed to send push in visitor_arrival:', pushErr.message);
    }
  });

  // Visitor decision (approve/deny) — Resident notifies guard
  socket.on('visitor_decision', (data) => {
    console.log('[Socket] Visitor Decision:', data);
    io.to('guard_room').emit('visitor_decision_result', data);
  });

  socket.on('disconnect', async () => {
    console.log(`[Socket] User disconnected: ${socket.id}`);
    if (socket.role === 'guard' && socket.userId) {
      try {
        await db.execute('UPDATE users SET is_online = FALSE WHERE id = ?', [socket.userId]);
        console.log(`[Socket] Guard ${socket.userId} is now OFFLINE`);
        io.emit('guards_status_update');
      } catch (err) {
        console.error('Failed to mark guard offline:', err.message);
      }
    }
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
app.use('/api/notifications', require('./routes/notifications'));

// ── Auto-Migration on Startup ─────────────────────────────────
// Nayi tables automatically create ho jayengi agar exist nahi karti
// Hostinger par manual migration ki zaroorat nahi padegi
async function autoMigrate() {
  try {
    // Add tower columns safely
    try {
      await db.execute('ALTER TABLE users ADD COLUMN tower VARCHAR(50) DEFAULT NULL AFTER society_id');
      console.log('✅ Auto-migration: Added tower column to users successfully.');
    } catch (e) { /* ignore if already exists */ }

    try {
      await db.execute('ALTER TABLE users ADD COLUMN is_online BOOLEAN DEFAULT FALSE AFTER role');
      console.log('✅ Auto-migration: Added is_online column to users successfully.');
    } catch (e) { /* ignore if already exists */ }

    try {
      await db.execute('ALTER TABLE home_chores ADD COLUMN tower VARCHAR(50) DEFAULT NULL AFTER society_id');
      console.log('✅ Auto-migration: Added tower column to home_chores successfully.');
    } catch (e) { /* ignore if already exists */ }

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
      CREATE TABLE IF NOT EXISTS society_settings (
        society_id        INT PRIMARY KEY,
        anpr              BOOLEAN NOT NULL DEFAULT TRUE,
        preapproved       BOOLEAN NOT NULL DEFAULT TRUE,
        manual            BOOLEAN NOT NULL DEFAULT TRUE,
        vehicles          BOOLEAN NOT NULL DEFAULT TRUE,
        checkout          BOOLEAN NOT NULL DEFAULT TRUE,
        sos               BOOLEAN NOT NULL DEFAULT TRUE,
        vehicle_mandatory BOOLEAN NOT NULL DEFAULT FALSE,
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE
      )
    `);

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

    await db.execute(`
      CREATE TABLE IF NOT EXISTS society_towers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        society_id INT NOT NULL,
        tower_name VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_tower (society_id, tower_name),
        FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE
      )
    `);

    // In-app notification storage (persistent notification bell)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS in_app_notifications (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        society_id  INT         DEFAULT NULL,
        user_id     INT         DEFAULT NULL,
        tower       VARCHAR(50) DEFAULT NULL,
        flat_number VARCHAR(20) DEFAULT NULL,
        type        VARCHAR(50) DEFAULT 'general',
        title       VARCHAR(255) NOT NULL,
        message     TEXT        NOT NULL,
        is_read     BOOLEAN     DEFAULT FALSE,
        created_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
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

    try {
      await db.execute('ALTER TABLE entry_logs ADD COLUMN vehicle_number VARCHAR(50) DEFAULT NULL');
      console.log('✅ Auto-migration: Added vehicle_number column to entry_logs successfully.');
    } catch (e) { /* ignore if already exists */ }

    try {
      await db.execute(`ALTER TABLE guests ADD COLUMN approval_status ENUM('pending','approved','denied','expired') DEFAULT 'approved'`);
      console.log('✅ Auto-migration: Added approval_status column to guests successfully.');
    } catch (e) { /* ignore if already exists */ }

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

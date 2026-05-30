const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const db = require('../config/db');
const { verifyToken } = require('../middlewares/auth');

// Registration Route (Sets account_status to pending)
router.post('/register', async (req, res) => {
  const { name, phone, password, tower, flat_number, society_id, role = 'resident_primary' } = req.body;

  try {
    // Basic validation
    if (!name || !phone || !password || !society_id) {
      return res.status(400).json({ message: 'All fields including Society PIN validation are required' });
    }

    // Hash the password securely
    const password_hash = await bcrypt.hash(password, 10); 

    // Insert user with status 'pending'
    const [result] = await db.execute(
      `INSERT INTO users (name, phone, password_hash, role, account_status, tower, flat_number, society_id) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [name, phone, password_hash, role, tower || null, flat_number || null, society_id]
    );

    // Emit event to managers (only if socket server is ready)
    const io = req.app.get('io');
    if (io) {
      io.to('manager_room').emit('new_approval_request', {
        id: result.insertId,
        name,
        tower,
        flat_number,
        phone
      });
    }

    res.status(201).json({ 
      message: 'Registration successful! Please wait for Manager approval before logging in.',
      userId: result.insertId 
    });

  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Phone number already registered' });
    }
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
});

// Login Route
router.post('/login', async (req, res) => {
  const { phone, password } = req.body; // Mock OTP using password

  try {
    const [users] = await db.execute(`
      SELECT u.*, s.name AS society_name, s.address AS society_address, s.city AS society_city 
      FROM users u
      LEFT JOIN societies s ON u.society_id = s.id
      WHERE u.phone = ?
    `, [phone]);
    
    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = users[0];

    // Check account status
    if (user.account_status === 'pending') {
      return res.status(403).json({ message: 'Account pending manager approval.' });
    }
    if (user.account_status === 'rejected') {
      return res.status(403).json({ message: 'Account application was rejected.' });
    }

    // Verify Password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials or OTP' });
    }

    // Generate JWT — includes society_id for role-based isolation
    const token = jwt.sign(
      { id: user.id, role: user.role, tower: user.tower, flat_number: user.flat_number, society_id: user.society_id }, 
      process.env.JWT_SECRET || 'secret_key',
      { expiresIn: '30d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        tower: user.tower,
        flat_number: user.flat_number,
        society_id: user.society_id,
        society_name: user.society_name,
        society_address: user.society_address,
        society_city: user.society_city
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
});

// GET /profile
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const [users] = await db.execute(`
      SELECT u.id, u.name, u.phone, u.role, u.tower, u.flat_number, u.society_id, u.created_at,
             s.name AS society_name, s.address AS society_address, s.city AS society_city
      FROM users u
      LEFT JOIN societies s ON u.society_id = s.id
      WHERE u.id = ?
    `, [req.user.id]);
    if (users.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json(users[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// PUT /profile
router.put('/profile', verifyToken, async (req, res) => {
  const { name, phone, currentPassword, newPassword } = req.body;
  try {
    const [users] = await db.execute('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) return res.status(404).json({ message: 'User not found' });
    
    const user = users[0];
    let newHash = user.password_hash;
    
    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ message: 'Current password is required to set a new password.' });
      const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isMatch) return res.status(401).json({ message: 'Current password is incorrect.' });
      newHash = await bcrypt.hash(newPassword, 10);
    }
    
    await db.execute(
      'UPDATE users SET name = ?, phone = ?, password_hash = ? WHERE id = ?',
      [name || user.name, phone || user.phone, newHash, req.user.id]
    );
    
    res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'Phone number already taken' });
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// TEMPORARY SETUP ROUTE — DISABLED IN PRODUCTION
// Uncomment locally only. Never expose this on a live server.
router.get('/setup-admin', (req, res) => {
  res.status(403).json({ message: 'This route is disabled in production.' });
});

// CLEAR DUMMY DATA ROUTE — DISABLED IN PRODUCTION
// Uncomment locally only. Never expose this on a live server.
router.get('/clear-dummy-data', (req, res) => {
  res.status(403).json({ message: 'This route is disabled in production.' });
});

// RUN MIGRATIONS ROUTE
// Visit: /api/auth/run-migrations to run tables setup
router.get('/run-migrations', async (req, res) => {
  const fs = require('fs');
  const path = require('path');
  try {
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const files = ['emergency_contacts.sql', 'push_subscriptions.sql'];
    let logs = [];

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      if (fs.existsSync(filePath)) {
        const sql = fs.readFileSync(filePath, 'utf8');
        const queries = sql
          .split(';')
          .map(q => q.trim())
          .filter(q => q.length > 0 && !q.startsWith('--'));

        logs.push(`Running ${queries.length} queries from ${file}...`);
        for (const query of queries) {
          try {
            await db.execute(query);
          } catch (queryErr) {
            logs.push(`Error executing: ${query.substring(0, 50)}... -> ${queryErr.message}`);
          }
        }
        logs.push(`Finished ${file}`);
      } else {
        logs.push(`File not found: ${file}`);
      }
    }

    res.json({ message: 'Migration run complete', logs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Migration failed', error: err.message });
  }
});

// DEBUG DB ROUTE — DISABLED IN PRODUCTION (PII exposure risk)
router.get('/debug-db', (req, res) => {
  res.status(403).json({ message: 'This route is disabled in production.' });
});


// HEAL DATABASE ROUTE
// Visit: /api/auth/heal-db to manually auto-heal the remote MySQL database schemas
router.get('/heal-db', async (req, res) => {
  const results = [];
  try {
    // 1. Add tower column to users table if not exists
    try {
      await db.execute('ALTER TABLE users ADD COLUMN tower VARCHAR(50) DEFAULT NULL AFTER society_id');
      results.push('Added tower column to users successfully.');
    } catch (e) {
      results.push(`tower on users: ${e.message}`);
    }

    // 2. Add is_online column to users table if not exists
    try {
      await db.execute('ALTER TABLE users ADD COLUMN is_online BOOLEAN DEFAULT FALSE AFTER role');
      results.push('Added is_online column to users successfully.');
    } catch (e) {
      results.push(`is_online on users: ${e.message}`);
    }

    // 3. Create home_chores table if not exists
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS home_chores (
          id INT AUTO_INCREMENT PRIMARY KEY,
          society_id INT NOT NULL,
          tower VARCHAR(50) DEFAULT NULL,
          flat_number VARCHAR(20) NOT NULL,
          text TEXT NOT NULL,
          is_done BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      results.push('Table home_chores verified/created successfully.');
    } catch (e) {
      results.push(`home_chores table: ${e.message}`);
    }

    // 4. Add tower column to home_chores if not exists
    try {
      await db.execute('ALTER TABLE home_chores ADD COLUMN tower VARCHAR(50) DEFAULT NULL AFTER society_id');
      results.push('Added tower column to home_chores successfully.');
    } catch (e) {
      results.push(`tower on home_chores: ${e.message}`);
    }

    // 5. Add vehicle_number column to entry_logs table if not exists
    try {
      await db.execute('ALTER TABLE entry_logs ADD COLUMN vehicle_number VARCHAR(20) DEFAULT NULL');
      results.push('Added vehicle_number column to entry_logs successfully.');
    } catch (e) {
      results.push(`vehicle_number on entry_logs: ${e.message}`);
    }

    // 6. Create society_settings table if not exists
    try {
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
          updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      results.push('Table society_settings verified/created successfully.');
    } catch (e) {
      results.push(`society_settings table: ${e.message}`);
    }

    // 7. Create emergency_contacts table if not exists
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS emergency_contacts (
          id         INT AUTO_INCREMENT PRIMARY KEY,
          society_id INT NOT NULL,
          name       VARCHAR(100) NOT NULL,
          phone      VARCHAR(20)  NOT NULL,
          category   VARCHAR(50)  NOT NULL DEFAULT 'Other',
          priority   INT          NOT NULL DEFAULT 5,
          created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      results.push('Table emergency_contacts verified/created successfully.');
    } catch (e) {
      results.push(`emergency_contacts table: ${e.message}`);
    }

    // 8. Create community_posts table if not exists
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS community_posts (
          id INT AUTO_INCREMENT PRIMARY KEY,
          society_id INT NOT NULL,
          author_id INT NOT NULL,
          type VARCHAR(20) DEFAULT 'post',
          title VARCHAR(255) NOT NULL,
          body TEXT NULL,
          poll_options TEXT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      results.push('Table community_posts verified/created successfully.');
    } catch (e) {
      results.push(`community_posts table: ${e.message}`);
    }

    // 9. Create community_likes table if not exists
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS community_likes (
          id INT AUTO_INCREMENT PRIMARY KEY,
          post_id INT NOT NULL,
          user_id INT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_post_user (post_id, user_id)
        )
      `);
      results.push('Table community_likes verified/created successfully.');
    } catch (e) {
      results.push(`community_likes table: ${e.message}`);
    }

    // 10. Create community_comments table if not exists
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS community_comments (
          id INT AUTO_INCREMENT PRIMARY KEY,
          post_id INT NOT NULL,
          author_id INT NOT NULL,
          text TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      results.push('Table community_comments verified/created successfully.');
    } catch (e) {
      results.push(`community_comments table: ${e.message}`);
    }

    // 11. Create community_poll_votes table if not exists
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS community_poll_votes (
          id INT AUTO_INCREMENT PRIMARY KEY,
          post_id INT NOT NULL,
          user_id INT NOT NULL,
          selected_option VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_post_user_vote (post_id, user_id)
        )
      `);
      results.push('Table community_poll_votes verified/created successfully.');
    } catch (e) {
      results.push(`community_poll_votes table: ${e.message}`);
    }

    // 12. Create society_towers table if not exists
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS society_towers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          society_id INT NOT NULL,
          tower_name VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_tower (society_id, tower_name)
        )
      `);
      results.push('Table society_towers verified/created successfully.');
    } catch (e) {
      results.push(`society_towers table: ${e.message}`);
    }

    // 13. Create in_app_notifications table if not exists
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS in_app_notifications (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT DEFAULT NULL,
          society_id INT DEFAULT NULL,
          tower VARCHAR(50) DEFAULT NULL,
          flat_number VARCHAR(20) DEFAULT NULL,
          title VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          type VARCHAR(50) DEFAULT 'general',
          is_read BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      results.push('Table in_app_notifications verified/created successfully.');
    } catch (e) {
      results.push(`in_app_notifications table: ${e.message}`);
    }

    res.json({ success: true, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;


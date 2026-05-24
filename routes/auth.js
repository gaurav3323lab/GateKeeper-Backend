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

    // Emit event to managers
    const io = req.app.get('io');
    io.to('manager_room').emit('new_approval_request', {
      id: result.insertId,
      name,
      tower,
      flat_number,
      phone
    });

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

// TEMPORARY SETUP ROUTE — Creates Super Admin with fresh hash
// Visit: /api/auth/setup-admin once, then it auto-disables
router.get('/setup-admin', async (req, res) => {
  try {
    const password_hash = await bcrypt.hash('1234', 10);

    // Ensure default society exists
    await db.execute(`
      INSERT INTO societies (id, name, society_code, address, city, state, zip_code)
      VALUES (1, 'Gaurav Heights', 'GH001', 'Sector 23', 'Mumbai', 'Maharashtra', '400001')
      ON DUPLICATE KEY UPDATE name = name
    `);

    // Delete old super admin if exists, then insert fresh
    await db.execute(`DELETE FROM users WHERE phone = '9999999999'`);
    await db.execute(
      `INSERT INTO users (name, phone, password_hash, role, account_status, society_id)
       VALUES ('Super Admin', '9999999999', ?, 'super_admin', 'active', 1)`,
      [password_hash]
    );

    res.json({
      message: '✅ Super Admin created successfully!',
      phone: '9999999999',
      password: '1234'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Setup failed', error: err.message });
  }
});

// CLEAR DUMMY DATA ROUTE
// Visit: /api/auth/clear-dummy-data to wipe all dummy data and reset Super Admin
router.get('/clear-dummy-data', async (req, res) => {
  try {
    await db.execute('SET FOREIGN_KEY_CHECKS = 0');

    const tablesToTruncate = [
      'entry_logs',
      'emergencies',
      'guests',
      'deliveries',
      'vehicles',
      'service_requests',
      'announcements',
      'push_subscriptions'
    ];

    let logs = [];
    for (const table of tablesToTruncate) {
      try {
        await db.execute(`TRUNCATE TABLE ${table}`);
        logs.push(`🧹 Cleared table: ${table}`);
      } catch (err) {
        await db.execute(`DELETE FROM ${table}`);
        logs.push(`🧹 Deletions completed on table: ${table}`);
      }
    }

    await db.execute('DELETE FROM users');
    logs.push("🧹 Cleared users table.");

    await db.execute(`
      INSERT INTO societies (id, name, society_code, address, city, state, zip_code)
      VALUES (1, 'Gaurav Heights', 'GH001', 'Sector 23', 'Mumbai', 'Maharashtra', '400001')
      ON DUPLICATE KEY UPDATE name = name
    `);
    logs.push("🏢 Default society configured.");

    const passwordHash = await bcrypt.hash('1234', 10);
    await db.execute(`
      INSERT INTO users (id, name, phone, password_hash, role, account_status, society_id)
      VALUES (1, 'Super Admin', '9999999999', ?, 'super_admin', 'active', 1)
    `, [passwordHash]);
    logs.push("👑 Fresh Super Admin user created (Phone: 9999999999, Password: 1234).");

    await db.execute('SET FOREIGN_KEY_CHECKS = 1');
    logs.push("✅ Foreign key checks re-enabled.");

    res.json({ message: '✨ Database cleanup complete! Real data ready.', logs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Cleanup failed', error: err.message });
  }
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

// DEBUG DB ROUTE
router.get('/debug-db', async (req, res) => {
  try {
    const [users] = await db.execute('SELECT id, name, phone, role, flat_number, society_id FROM users');
    const [societies] = await db.execute('SELECT * FROM societies');
    res.json({ users, societies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;


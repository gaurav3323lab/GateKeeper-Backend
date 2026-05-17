const express = require('express');
const router = express.Router();
const { createWorker } = require('tesseract.js');
const db = require('../config/db');
const { verifyToken } = require('../middlewares/auth');

// POST /api/entry/scan-plate
// Accepts: { imageBase64: "data:image/jpeg;base64,..." }
router.post('/scan-plate', async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ message: 'Image data required' });

  try {
    const worker = await createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
      tessedit_pageseg_mode: '7',
    });
    const { data: { text, confidence } } = await worker.recognize(imageBase64);
    await worker.terminate();
    const cleaned = text.replace(/[^A-Z0-9 ]/g, '').trim();
    res.json({ text: cleaned, confidence: Math.round(confidence) });
  } catch (err) {
    console.error('OCR Error:', err.message);
    res.status(500).json({ message: 'OCR processing failed', error: err.message });
  }
});

// POST /api/entry/sos
// ✅ Fixed: removed broken guard_id FK insert. Now only logs to emergencies + emits socket.
router.post('/sos', async (req, res) => {
  const { user_id, flat_number, user_name } = req.body;
  if (!user_id) return res.status(400).json({ message: 'user_id required' });

  try {
    const [result] = await db.execute(
      `INSERT INTO emergencies (user_id, status) VALUES (?, 'Active')`,
      [user_id]
    );

    // Broadcast SOS via Socket to guards and managers
    const io = req.app.get('io');
    if (io) {
      io.to('guard_room').to('manager_room').emit('sos_alert', {
        message: `🚨 EMERGENCY SOS from Flat ${flat_number} — ${user_name}`,
        flat_number,
        user_name,
        userId: user_id,
        timestamp: new Date()
      });
    }

    res.status(201).json({ message: 'SOS sent successfully', id: result.insertId });
  } catch (err) {
    console.error('SOS Error:', err);
    res.status(500).json({ message: 'Failed to send SOS', error: err.message });
  }
});

// POST /api/entry/manual-log
// Guard manually logs a visitor entry with full entry_logs recording
router.post('/manual-log', async (req, res) => {
  const { visitor_name, visitor_phone, flat_number, purpose, guard_id } = req.body;
  if (!visitor_name || !flat_number) return res.status(400).json({ message: 'visitor_name and flat_number required' });

  try {
    // 1. Find resident host_id matching the flat number (roles primary/family)
    const [users] = await db.execute(
      `SELECT id FROM users WHERE flat_number = ? AND role IN ('resident_primary', 'resident_family') LIMIT 1`,
      [flat_number]
    );
    
    const hostId = users.length > 0 ? users[0].id : null;

    // 2. Insert into guests table
    const [guestResult] = await db.execute(
      `INSERT INTO guests (name, phone, purpose, host_id, qr_code, valid_from, valid_to)
       VALUES (?, ?, ?, ?, CONCAT('manual_', UNIX_TIMESTAMP()), NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY))`,
      [visitor_name, visitor_phone || 'N/A', purpose || 'Walk-in', hostId]
    );

    const guestId = guestResult.insertId;

    // 3. Insert into entry_logs table so it shows up in Resident's activity logs!
    await db.execute(
      `INSERT INTO entry_logs (entity_type, entity_id, entry_time, gate_number, guard_id)
       VALUES ('guest', ?, NOW(), 'Gate 1', ?)`,
      [guestId, guard_id || null]
    );

    // 4. Emit real-time log event to Resident's flat room so their logs page auto-refreshes!
    const io = req.app.get('io');
    if (io) {
      io.to(`flat_${flat_number}`).emit('entry_log_created', {
        message: 'Naya Entry Log Aaya Hai!'
      });
    }

    res.status(201).json({ message: 'Entry logged successfully', id: guestId });
  } catch (err) {
    console.error('Manual Log Error:', err);
    res.status(500).json({ message: 'Failed to log manual entry', error: err.message });
  }
});

// POST /api/entry/log-preapproved
// Guard logs check-in for preapproved guests or deliveries
router.post('/log-preapproved', async (req, res) => {
  const { entity_type, entity_id, guard_id } = req.body;
  if (!entity_type || !entity_id) return res.status(400).json({ message: 'entity_type and entity_id required' });

  try {
    // 1. Insert into entry_logs table
    await db.execute(
      `INSERT INTO entry_logs (entity_type, entity_id, entry_time, gate_number, guard_id)
       VALUES (?, ?, NOW(), 'Gate 1', ?)`,
      [entity_type, entity_id, guard_id || null]
    );

    // 2. If it is a delivery, update delivery status to 'arrived' or 'completed'
    if (entity_type === 'delivery') {
      await db.execute(
        `UPDATE deliveries SET status = 'arrived' WHERE id = ?`,
        [entity_id]
      );
    }

    // 3. Query flat_number to emit socket to the target resident's flat room!
    let flat_number = '';
    if (entity_type === 'guest') {
      const [rows] = await db.execute(
        `SELECT u.flat_number FROM guests g JOIN users u ON g.host_id = u.id WHERE g.id = ?`,
        [entity_id]
      );
      flat_number = rows[0]?.flat_number || '';
    } else if (entity_type === 'delivery') {
      const [rows] = await db.execute(
        `SELECT u.flat_number FROM deliveries d JOIN users u ON d.resident_id = u.id WHERE d.id = ?`,
        [entity_id]
      );
      flat_number = rows[0]?.flat_number || '';
    }

    if (flat_number) {
      const io = req.app.get('io');
      if (io) {
        io.to(`flat_${flat_number}`).emit('entry_log_created', {
          message: 'Naya Entry Log Aaya Hai!'
        });
      }
    }

    res.status(201).json({ message: 'Pre-approved entry logged successfully' });
  } catch (err) {
    console.error('Pre-approved log error:', err);
    res.status(500).json({ message: 'Failed to log entry', error: err.message });
  }
});

// GET /api/entry/logs
// Get recent entry logs for manager/guard view
router.get('/logs', async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT 
        el.id, el.entity_type, el.entry_time, el.exit_time, el.gate_number,
        CASE 
          WHEN el.entity_type = 'guest' THEN g.name
          WHEN el.entity_type = 'vehicle' THEN v.vehicle_number
          WHEN el.entity_type = 'staff' THEN s.name
          ELSE 'Unknown'
        END AS entity_name,
        u.name AS guard_name
      FROM entry_logs el
      LEFT JOIN guests g ON el.entity_type = 'guest' AND el.entity_id = g.id
      LEFT JOIN vehicles v ON el.entity_type = 'vehicle' AND el.entity_id = v.id
      LEFT JOIN staff s ON el.entity_type = 'staff' AND el.entity_id = s.id
      LEFT JOIN users u ON el.guard_id = u.id
      ORDER BY el.entry_time DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    console.error('Entry Logs Error:', err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// GET /api/entry/resident-logs
// Get entry logs specifically for the logged-in resident's guests, vehicles, and deliveries
router.get('/resident-logs', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Guests
    const [guests] = await db.execute(`
      SELECT g.id, 'Guest' as type, g.name, g.purpose, g.created_at, el.entry_time, el.exit_time
      FROM guests g
      LEFT JOIN entry_logs el ON el.entity_type = 'guest' AND el.entity_id = g.id
      WHERE g.host_id = ?
      ORDER BY g.created_at DESC LIMIT 15
    `, [userId]);

    // Vehicles
    const [vehicles] = await db.execute(`
      SELECT v.id, 'Vehicle' as type, v.vehicle_number as name, v.type as purpose, el.entry_time, el.exit_time, el.entry_time as created_at
      FROM vehicles v
      JOIN entry_logs el ON el.entity_type = 'vehicle' AND el.entity_id = v.id
      WHERE v.user_id = ?
      ORDER BY el.entry_time DESC LIMIT 15
    `, [userId]);

    // Deliveries
    const [deliveries] = await db.execute(`
      SELECT d.id, 'Delivery' as type, d.company as name, d.status as purpose, d.created_at, d.updated_at as entry_time, NULL as exit_time
      FROM deliveries d
      WHERE d.resident_id = ?
      ORDER BY d.created_at DESC LIMIT 15
    `, [userId]);

    // Combine and sort by newest first
    const logs = [...guests, ...vehicles, ...deliveries].sort((a, b) => {
      const timeA = new Date(a.entry_time || a.created_at).getTime();
      const timeB = new Date(b.entry_time || b.created_at).getTime();
      return timeB - timeA;
    });

    res.json(logs);
  } catch (err) {
    console.error('Resident Logs Error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// GET /api/entry/emergencies
// Get active emergency SOS list
router.get('/emergencies', async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT e.*, u.name AS user_name, u.flat_number, u.phone
      FROM emergencies e
      JOIN users u ON e.user_id = u.id
      ORDER BY e.created_at DESC
      LIMIT 20
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// PUT /api/entry/emergencies/:id/resolve
router.put('/emergencies/:id/resolve', async (req, res) => {
  try {
    await db.execute(
      `UPDATE emergencies SET status = 'Resolved', resolved_by = ? WHERE id = ?`,
      [req.body.resolved_by || null, req.params.id]
    );
    res.json({ message: 'Emergency resolved' });
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── Resident Pre-Approvals ──────────────────────────────────
// GET /api/entry/pre-approvals
router.get('/pre-approvals', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const [guests] = await db.execute(`
      SELECT id, 'guest' AS type, name, phone, purpose, DATE_FORMAT(valid_to, '%Y-%m-%d') AS valid_date, qr_code
      FROM guests WHERE host_id = ? AND valid_to >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `, [userId]);

    const [deliveries] = await db.execute(`
      SELECT id, 'delivery' AS type, company AS company, 'Delivery' AS purpose, DATE_FORMAT(created_at, '%Y-%m-%d') AS valid_date, NULL AS qr_code
      FROM deliveries WHERE resident_id = ? AND status IN ('pending', 'approved')
    `, [userId]);

    res.json([...guests, ...deliveries]);
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// POST /api/entry/pre-approve
router.post('/pre-approve', verifyToken, async (req, res) => {
  const { type, company, name, phone, purpose, valid_date } = req.body;
  try {
    const userId = req.user.id;
    let insertId;

    if (type === 'delivery') {
      const [result] = await db.execute(
        `INSERT INTO deliveries (company, delivery_person_name, phone, resident_id, status) VALUES (?, 'Pending', '', ?, 'approved')`,
        [company || 'Other', userId]
      );
      insertId = result.insertId;
    } else {
      const validTo = valid_date ? `${valid_date} 23:59:59` : new Date(Date.now() + 86400000).toISOString().slice(0, 19).replace('T', ' ');
      // Generate a 6-digit numeric PIN
      const pin = Math.floor(100000 + Math.random() * 900000).toString();
      const [result] = await db.execute(
        `INSERT INTO guests (name, phone, purpose, host_id, qr_code, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
        [name, phone || '', purpose || 'Guest', userId, pin, validTo]
      );
      insertId = result.insertId;
    }

    const io = req.app.get('io');
    if (io) {
      // Get user flat
      const [user] = await db.execute('SELECT flat_number FROM users WHERE id = ?', [userId]);
      const flat = user[0]?.flat_number || '';
      io.to('guard_room').emit('new_pre_approval', {
        message: `Naya Pre-Approval Aaya Hai: Flat ${flat} se ${type === 'delivery' ? company : name} ke liye.`,
        type
      });
    }

    res.status(201).json({ message: 'Added successfully', id: insertId });
  } catch (err) {
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// DELETE /api/entry/pre-approve/:type/:id
router.delete('/pre-approve/:type/:id', verifyToken, async (req, res) => {
  const { type, id } = req.params;
  const userId = req.user.id;
  try {
    if (type === 'delivery') {
      await db.execute('DELETE FROM deliveries WHERE id = ? AND resident_id = ?', [id, userId]);
    } else {
      await db.execute('DELETE FROM guests WHERE id = ? AND host_id = ?', [id, userId]);
    }
    res.json({ message: 'Removed successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

module.exports = router;

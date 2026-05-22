const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken, authorizeRoles, roles } = require('../middlewares/auth');
const { sendPushToUser, sendPushToFlat } = require('../utils/sendPush');

router.use(verifyToken);
router.use(authorizeRoles(roles.GUARD));

// Auto-heal society_id if missing for Guard
router.use(async (req, res, next) => {
  try {
    const [guard] = await db.execute('SELECT society_id FROM users WHERE id = ?', [req.user.id]);
    if (guard.length > 0 && !guard[0].society_id) {
      await db.execute('UPDATE users SET society_id = 1 WHERE id = ?', [req.user.id]);
    }
    next();
  } catch (err) {
    console.error('Guard society auto-heal failed:', err);
    next();
  }
});

// ── GET Pre-Approved Guests & Deliveries ─────────────────────
router.get('/pre-approved', async (req, res) => {
  try {
    const [guard] = await db.execute('SELECT society_id FROM users WHERE id = ?', [req.user.id]);
    const societyId = guard[0].society_id;

    const [guests] = await db.execute(`
      SELECT g.id, 'guest' AS type, g.name, g.phone AS phone, g.purpose, g.valid_to AS valid_date,
        u.flat_number AS flat, u.name AS resident_name, g.qr_code
      FROM guests g
      JOIN users u ON g.host_id = u.id
      WHERE g.valid_to >= DATE_SUB(NOW(), INTERVAL 3 DAY) 
        AND u.society_id = ?
        AND g.id NOT IN (SELECT DISTINCT entity_id FROM entry_logs WHERE entity_type = 'guest')
      ORDER BY g.valid_to ASC
    `, [societyId]);

    const [deliveries] = await db.execute(`
      SELECT d.id, 'delivery' AS type, d.company AS name, 'Delivery' AS purpose, d.phone AS phone, d.created_at AS valid_date,
        u.flat_number AS flat, u.name AS resident_name, NULL AS qr_code
      FROM deliveries d
      JOIN users u ON d.resident_id = u.id
      WHERE (d.status = 'pending' OR d.status = 'approved') 
        AND u.society_id = ?
        AND d.id NOT IN (SELECT DISTINCT entity_id FROM entry_logs WHERE entity_type = 'delivery')
      ORDER BY d.created_at DESC
      LIMIT 30
    `, [societyId]);

    res.json([...guests, ...deliveries]);
  } catch (err) {
    console.error('Pre-approved Error:', err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// GET /api/guard/verify-pin/:pin
// Direct database lookup for any 6-digit invitation PIN code
router.get('/verify-pin/:pin', async (req, res) => {
  try {
    const pin = req.params.pin;
    const [rows] = await db.execute(`
      SELECT g.id, 'guest' AS type, g.name, g.phone AS phone, g.purpose, g.valid_to AS valid_date,
             u.flat_number AS flat, u.name AS resident_name, g.qr_code
      FROM guests g
      JOIN users u ON g.host_id = u.id
      WHERE TRIM(g.qr_code) = ? AND g.valid_to >= DATE_SUB(NOW(), INTERVAL 3 DAY)
      LIMIT 1
    `, [pin.trim()]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Invalid PIN Code' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Verify PIN error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// GET /api/guard/verify-vehicle/:plate
// Look up vehicle details (owner name, flat number, current status: Inside/Outside) in the guard's society
router.get('/verify-vehicle/:plate', async (req, res) => {
  try {
    const [guard] = await db.execute('SELECT society_id FROM users WHERE id = ?', [req.user.id]);
    const societyId = guard[0]?.society_id || 1;
    const plate = req.params.plate.replace(/[^A-Z0-9]/g, '').trim().toUpperCase();

    const [rows] = await db.execute(`
      SELECT v.id, v.vehicle_number, v.type, v.brand, v.status,
             u.name AS owner_name, u.flat_number, u.phone
      FROM vehicles v
      JOIN users u ON v.user_id = u.id
      WHERE REPLACE(v.vehicle_number, ' ', '') = ? AND u.society_id = ?
      LIMIT 1
    `, [plate, societyId]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Vehicle not registered' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Verify vehicle error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── GET Recent Entry Logs (last 50) ──────────────────────────────
router.get('/entry-logs', async (req, res) => {
  try {
    const [guard] = await db.execute('SELECT society_id FROM users WHERE id = ?', [req.user.id]);
    const societyId = guard[0].society_id;

    const [rows] = await db.execute(`
      SELECT 
        el.id, el.entity_type, el.entry_time, el.exit_time, el.gate_number,
        CASE 
          WHEN el.entity_type = 'guest' THEN g.name
          WHEN el.entity_type = 'vehicle' THEN v.vehicle_number
          WHEN el.entity_type = 'staff' THEN s.name
          ELSE 'Unknown'
        END AS entity_name,
        gu.name AS guard_name
      FROM entry_logs el
      LEFT JOIN guests g ON el.entity_type = 'guest' AND el.entity_id = g.id
      LEFT JOIN vehicles v ON el.entity_type = 'vehicle' AND el.entity_id = v.id
      LEFT JOIN staff s ON el.entity_type = 'staff' AND el.entity_id = s.id
      LEFT JOIN users gu ON el.guard_id = gu.id
      WHERE gu.society_id = ? OR (el.guard_id IS NULL AND gu.id IS NULL)
      ORDER BY el.entry_time DESC
      LIMIT 50
    `, [societyId]);
    res.json(rows);
  } catch (err) {
    console.error('Entry Logs Error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── GET Active Emergencies ────────────────────────────────────
router.get('/emergencies', async (req, res) => {
  try {
    const [guard] = await db.execute('SELECT society_id FROM users WHERE id = ?', [req.user.id]);
    const societyId = guard[0].society_id;

    const [rows] = await db.execute(`
      SELECT e.*, u.name AS user_name, u.flat_number, u.phone
      FROM emergencies e JOIN users u ON e.user_id = u.id
      WHERE e.status = 'Active' AND u.society_id = ?
      ORDER BY e.created_at DESC
    `, [societyId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── GET Vehicle Stats (Inside/Outside count + logs) ──────────
router.get('/vehicle-stats', async (req, res) => {
  try {
    const [guard] = await db.execute('SELECT society_id FROM users WHERE id = ?', [req.user.id]);
    const societyId = guard[0].society_id;

    // Count vehicles inside and outside
    const [counts] = await db.execute(`
      SELECT 
        SUM(CASE WHEN status = 'Inside' THEN 1 ELSE 0 END) AS inside_count,
        SUM(CASE WHEN status = 'Outside' THEN 1 ELSE 0 END) AS outside_count,
        COUNT(*) AS total_count
      FROM vehicles v
      JOIN users u ON v.user_id = u.id
      WHERE u.society_id = ?
    `, [societyId]);

    // Get all vehicles with owner info and status
    const [vehicles] = await db.execute(`
      SELECT 
        v.id, v.vehicle_number, v.type, v.brand, v.status, v.created_at,
        u.name AS owner_name, u.flat_number, u.phone
      FROM vehicles v
      JOIN users u ON v.user_id = u.id
      WHERE u.society_id = ?
      ORDER BY v.status ASC, v.created_at DESC
    `, [societyId]);

    // Get recent vehicle entry/exit logs
    const [logs] = await db.execute(`
      SELECT 
        el.id, el.entry_time, el.exit_time, el.gate_number,
        v.vehicle_number, v.type, v.brand,
        u.name AS owner_name, u.flat_number
      FROM entry_logs el
      JOIN vehicles v ON el.entity_id = v.id
      JOIN users u ON v.user_id = u.id
      WHERE el.entity_type = 'vehicle' AND u.society_id = ?
      ORDER BY el.entry_time DESC
      LIMIT 30
    `, [societyId]);

    res.json({
      stats: counts[0],
      vehicles,
      logs
    });
  } catch (err) {
    console.error('Vehicle Stats Error:', err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// ── GET Visitors Currently Inside (Checked-in but not exited) ────────────────
router.get('/inside-visitors', async (req, res) => {
  try {
    const [guard] = await db.execute('SELECT society_id FROM users WHERE id = ?', [req.user.id]);
    const societyId = guard[0]?.society_id || 1;

    const [rows] = await db.execute(`
      SELECT el.id AS log_id, el.entity_type, el.entity_id, el.entry_time,
        CASE 
          WHEN el.entity_type = 'guest' THEN g.name
          WHEN el.entity_type = 'delivery' THEN d.company
          ELSE 'Visitor'
        END AS name,
        CASE 
          WHEN el.entity_type = 'guest' THEN g.phone
          WHEN el.entity_type = 'delivery' THEN d.phone
          ELSE 'N/A'
        END AS phone,
        u.flat_number AS flat, u.name AS resident_name
      FROM entry_logs el
      LEFT JOIN guests g ON el.entity_type = 'guest' AND el.entity_id = g.id
      LEFT JOIN deliveries d ON el.entity_type = 'delivery' AND el.entity_id = d.id
      LEFT JOIN users u ON (el.entity_type = 'guest' AND g.host_id = u.id) OR (el.entity_type = 'delivery' AND d.resident_id = u.id)
      WHERE el.exit_time IS NULL AND el.entity_type IN ('guest', 'delivery') AND u.society_id = ?
      ORDER BY el.entry_time DESC
    `, [societyId]);

    res.json(rows);
  } catch (err) {
    console.error('Inside Visitors Error:', err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// ── POST Check-out (Mark Exit) for a Visitor ───────────────────
router.post('/checkout-visitor', async (req, res) => {
  const { log_id } = req.body;
  if (!log_id) return res.status(400).json({ message: 'log_id required' });

  try {
    // 1. Update exit_time in entry_logs
    await db.execute(
      `UPDATE entry_logs SET exit_time = NOW() WHERE id = ?`,
      [log_id]
    );

    // 2. Fetch visitor and flat info to send real-time socket notification to resident
    const [rows] = await db.execute(`
      SELECT el.entity_type, el.entity_id,
        CASE 
          WHEN el.entity_type = 'guest' THEN g.name
          WHEN el.entity_type = 'delivery' THEN d.company
          ELSE 'Visitor'
        END AS name,
        u.flat_number
      FROM entry_logs el
      LEFT JOIN guests g ON el.entity_type = 'guest' AND el.entity_id = g.id
      LEFT JOIN deliveries d ON el.entity_type = 'delivery' AND el.entity_id = d.id
      LEFT JOIN users u ON (el.entity_type = 'guest' AND g.host_id = u.id) OR (el.entity_type = 'delivery' AND d.resident_id = u.id)
      WHERE el.id = ?
    `, [log_id]);

    if (rows.length > 0) {
      const { name, flat_number } = rows[0];
      const io = req.app.get('io');
      if (io && flat_number) {
        io.to(`flat_${flat_number}`).emit('entry_log_created');
        io.to(`flat_${flat_number}`).emit('visitor_checked_out', {
          visitor_name: name
        });
      }

      // 🔔 Web Push — Resident ko checkout notification
      if (flat_number) {
        await sendPushToFlat(
          flat_number,
          `🚶 Visitor Chale Gaye`,
          `${name} society se bahar nikal gaye hain.`,
          { url: '/', type: 'checkout', flat_number }
        );
      }
    }

    res.json({ message: 'Visitor checked out successfully' });
  } catch (err) {
    console.error('Checkout Visitor Error:', err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// ── POST Vehicle Entry Log ─────────────────────────────────────
// Guard vehicle ko scan karke entry/exit mark karta hai
router.post('/vehicle-log', async (req, res) => {
  const { vehicle_id, action } = req.body; // action: 'entry' | 'exit'
  if (!vehicle_id || !action) return res.status(400).json({ message: 'vehicle_id aur action required hai' });

  try {
    // Fetch vehicle and owner info
    const [vehicleRows] = await db.execute(
      `SELECT v.vehicle_number, v.type, v.brand, u.id AS owner_id, u.flat_number, u.name AS owner_name
       FROM vehicles v JOIN users u ON v.user_id = u.id
       WHERE v.id = ?`,
      [vehicle_id]
    );

    if (!vehicleRows.length) return res.status(404).json({ message: 'Vehicle nahi mili' });
    const vehicle = vehicleRows[0];

    if (action === 'entry') {
      // Mark vehicle as Inside + create entry log
      await db.execute(`UPDATE vehicles SET status = 'Inside' WHERE id = ?`, [vehicle_id]);
      await db.execute(
        `INSERT INTO entry_logs (entity_type, entity_id, entry_time, gate_number, guard_id) VALUES ('vehicle', ?, NOW(), 'Gate 1', ?)`,
        [vehicle_id, req.user.id]
      );

      // Socket broadcast
      const io = req.app.get('io');
      if (io) io.to(`flat_${vehicle.flat_number}`).emit('entry_log_created');

      // 🔔 Web Push — Vehicle owner ko ENTRY notification
      await sendPushToUser(
        vehicle.owner_id,
        `🚗 Gaadi Society Mein Aayi!`,
        `${vehicle.vehicle_number} (${vehicle.type}) ne society mein ENTRY ki hai.`,
        { url: '/', type: 'vehicle_entry', vehicle_id }
      );

      res.json({ message: `${vehicle.vehicle_number} ki entry log ho gayi` });

    } else if (action === 'exit') {
      // Mark vehicle as Outside + update exit_time in latest entry log
      await db.execute(`UPDATE vehicles SET status = 'Outside' WHERE id = ?`, [vehicle_id]);
      await db.execute(
        `UPDATE entry_logs SET exit_time = NOW() 
         WHERE entity_type = 'vehicle' AND entity_id = ? AND exit_time IS NULL
         ORDER BY entry_time DESC LIMIT 1`,
        [vehicle_id]
      );

      // Socket broadcast
      const io = req.app.get('io');
      if (io) io.to(`flat_${vehicle.flat_number}`).emit('entry_log_created');

      // 🔔 Web Push — Vehicle owner ko EXIT notification
      await sendPushToUser(
        vehicle.owner_id,
        `🚗 Gaadi Bahar Gayi!`,
        `${vehicle.vehicle_number} (${vehicle.type}) ne society se EXIT ki hai.`,
        { url: '/', type: 'vehicle_exit', vehicle_id }
      );

      res.json({ message: `${vehicle.vehicle_number} ki exit log ho gayi` });

    } else {
      res.status(400).json({ message: 'Invalid action. Use "entry" or "exit"' });
    }
  } catch (err) {
    console.error('Vehicle Log Error:', err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

module.exports = router;


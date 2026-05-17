const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken, authorizeRoles, roles } = require('../middlewares/auth');

router.use(verifyToken);
router.use(authorizeRoles(roles.GUARD));

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
      WHERE g.valid_to >= DATE_SUB(NOW(), INTERVAL 24 HOUR) AND u.society_id = ?
      ORDER BY g.valid_to ASC
    `, [societyId]);

    const [deliveries] = await db.execute(`
      SELECT d.id, 'delivery' AS type, d.company AS name, 'Delivery' AS purpose, d.phone AS phone, d.created_at AS valid_date,
        u.flat_number AS flat, u.name AS resident_name, NULL AS qr_code
      FROM deliveries d
      JOIN users u ON d.resident_id = u.id
      WHERE (d.status = 'pending' OR d.status = 'approved') AND u.society_id = ?
      ORDER BY d.created_at DESC
      LIMIT 30
    `, [societyId]);

    res.json([...guests, ...deliveries]);
  } catch (err) {
    console.error('Pre-approved Error:', err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// ── GET Recent Entry Logs (last 50) ──────────────────────────
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
        u.name AS guard_name
      FROM entry_logs el
      LEFT JOIN guests g ON el.entity_type = 'guest' AND el.entity_id = g.id
      LEFT JOIN vehicles v ON el.entity_type = 'vehicle' AND el.entity_id = v.id
      LEFT JOIN staff s ON el.entity_type = 'staff' AND el.entity_id = s.id
      LEFT JOIN users u ON el.guard_id = u.id
      WHERE u.society_id = ?
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

module.exports = router;


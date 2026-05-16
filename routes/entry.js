const express = require('express');
const router = express.Router();
const { createWorker } = require('tesseract.js');
const db = require('../config/db');

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
// Guard manually logs a visitor entry
router.post('/manual-log', async (req, res) => {
  const { visitor_name, visitor_phone, flat_number, purpose, guard_id } = req.body;
  if (!visitor_name || !flat_number) return res.status(400).json({ message: 'visitor_name and flat_number required' });

  try {
    // Find a guest record or create one inline
    const [guestResult] = await db.execute(
      `INSERT INTO guests (name, phone, purpose, host_id, qr_code, valid_from, valid_to)
       SELECT ?, ?, ?, u.id, CONCAT('manual_', UNIX_TIMESTAMP()), NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY)
       FROM users u WHERE u.flat_number = ? AND u.role = 'resident_primary' LIMIT 1`,
      [visitor_name, visitor_phone || 'N/A', purpose || 'Walk-in', flat_number]
    );

    res.status(201).json({ message: 'Entry logged successfully', id: guestResult.insertId });
  } catch (err) {
    console.error('Manual Log Error:', err);
    // Fallback: if no resident found for that flat, still acknowledge
    res.status(201).json({ message: 'Entry acknowledged (flat resident not found in system)' });
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

module.exports = router;

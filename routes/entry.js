const express = require('express');
const router = express.Router();
const { createWorker } = require('tesseract.js');
const db = require('../config/db');
const { verifyToken } = require('../middlewares/auth');
const { sendPushToUser, sendPushToRole, sendPushToFlat } = require('../utils/sendPush');
const { cleanAndCorrectPlate } = require('../utils/anprHelper');

let ocrWorker = null;

async function getOCRWorker() {
  if (!ocrWorker) {
    console.log('[ANPR] Warming up Tesseract OCR worker...');
    ocrWorker = await createWorker('eng');
    await ocrWorker.setParameters({
      // Whitelist: only characters that appear on Indian plates
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      // PSM 7 = treat image as single line of text (best for number plates)
      tessedit_pageseg_mode: '7',
      // OEM 1 = LSTM neural network only (most accurate, no legacy mode)
      tessedit_ocr_engine_mode: '1',
      // No inter-word spacing — plate text is close-packed
      preserve_interword_spaces: '0',
    });
    console.log('[ANPR] Tesseract worker ready ✅');
  }
  return ocrWorker;
}

// POST /api/entry/scan-plate
// Accepts: { imageBase64: "data:image/jpeg;base64,..." }
router.post('/scan-plate', async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ message: 'Image data required' });

  try {
    const worker = await getOCRWorker();

    // Run OCR on the image
    const { data: { text, confidence } } = await worker.recognize(imageBase64);
    
    // Auto-heal common OCR recognition errors and layout-format the Indian license plate
    const parsed = cleanAndCorrectPlate(text);
    console.log(`[ANPR] Raw: "${text.replace(/\n/g, ' ').trim()}" → Corrected: "${parsed.formatted}" (Confidence: ${Math.round(confidence)}%)`);
    
    res.json({ text: parsed.formatted, confidence: Math.round(confidence) });
  } catch (err) {
    console.error('[ANPR] OCR Error:', err.message);
    // Reset worker so next request gets a fresh one
    if (ocrWorker) {
      try { await ocrWorker.terminate(); } catch (e) {}
      ocrWorker = null;
    }
    res.status(500).json({ message: 'OCR processing failed', error: err.message });
  }
});

// POST /api/entry/sos
router.post('/sos', async (req, res) => {
  const { user_id, tower, flat_number, user_name } = req.body;
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
        message: `🚨 EMERGENCY SOS from Flat ${tower ? tower + '-' : ''}${flat_number} — ${user_name}`,
        tower,
        flat_number,
        user_name,
        userId: user_id,
        timestamp: new Date()
      });
    }

    // 🔔 Web Push + In-App Notif — Guards aur Managers ko SOS notification
    // sendPushToRole already writes to in_app_notifications — no separate saveNotifForRole needed
    const flatCombined = `${tower ? tower + '-' : ''}${flat_number}`;
    const pushTitle = `🚨 EMERGENCY SOS!`;
    const pushBody = `Flat ${flatCombined} se SOS alert — ${user_name}. Turant respond karein!`;
    await Promise.all([
      sendPushToRole('guard', pushTitle, pushBody, { url: '/', type: 'sos', flat_number: flatCombined }),
      sendPushToRole('manager', pushTitle, pushBody, { url: '/', type: 'sos', flat_number: flatCombined }),
      sendPushToRole('super_admin', pushTitle, pushBody, { url: '/', type: 'sos', flat_number: flatCombined }),
    ]);


    res.status(201).json({ message: 'SOS sent successfully', id: result.insertId });
  } catch (err) {
    console.error('SOS Error:', err);
    res.status(500).json({ message: 'Failed to send SOS', error: err.message });
  }
});

// POST /api/entry/manual-log
// Guard manually logs a visitor entry with full details
router.post('/manual-log', async (req, res) => {
  const { visitor_name, visitor_phone, tower, flat_number, purpose, guard_id, vehicle_number, guest_id } = req.body;
  if (!visitor_name || !flat_number) return res.status(400).json({ message: 'visitor_name and flat_number required' });

  try {
    // Get guard's society_id to match residents of the same society
    let guardSocietyId = null;
    if (guard_id) {
      const [gRows] = await db.execute('SELECT society_id FROM users WHERE id = ?', [guard_id]);
      guardSocietyId = gRows[0]?.society_id || null;
    }

    // 1. Find resident host_id matching the tower, flat number, and society_id
    const [users] = await db.execute(
      `SELECT id, society_id FROM users 
       WHERE COALESCE(tower, '') = CAST(? AS CHAR) 
         AND flat_number = ? 
         AND role IN ('resident_primary', 'resident_family')
         ${guardSocietyId ? 'AND society_id = ?' : ''} 
       LIMIT 1`,
      guardSocietyId ? [tower || '', flat_number, guardSocietyId] : [tower || '', flat_number]
    );
    
    const hostId = users.length > 0 ? users[0].id : null;
    const residentSocietyId = users.length > 0 ? users[0].society_id : guardSocietyId;

    // 2. Insert into or update existing guests table record
    let guestId;
    let existingGuest = null;
    if (guest_id) {
      try {
        const [gRows] = await db.execute('SELECT id FROM guests WHERE id = ?', [guest_id]);
        if (gRows.length > 0) {
          existingGuest = gRows[0].id;
        }
      } catch (err) {
        console.warn('Failed to query existing guest_id:', err.message);
      }
    } else {
      // Safety Net: If guest_id is missing, auto-match by name & host created in last 2 minutes
      try {
        const [recentRows] = await db.execute(
          `SELECT id FROM guests 
           WHERE name = ? 
             AND host_id = ? 
             AND created_at >= DATE_SUB(NOW(), INTERVAL 2 MINUTE) 
           ORDER BY created_at DESC LIMIT 1`,
          [visitor_name, hostId]
        );
        if (recentRows.length > 0) {
          existingGuest = recentRows[0].id;
          console.log(`[Safety-Net] Auto-matched guest_id ${existingGuest} by name & host for double-call prevention!`);
        }
      } catch (err) {
        console.warn('Safety-net guest lookup failed:', err.message);
      }
    }

    if (existingGuest) {
      guestId = existingGuest;
      // Update existing guest info and mark approved
      try {
        await db.execute(
          `UPDATE guests 
           SET name = ?, phone = ?, purpose = ?, host_id = ?, approval_status = 'approved' 
           WHERE id = ?`,
          [visitor_name, visitor_phone || 'N/A', purpose || 'Walk-in', hostId, guestId]
        );
      } catch (colErr) {
        // Fallback if column missing or has errors
        await db.execute(
          `UPDATE guests 
           SET name = ?, phone = ?, purpose = ?, host_id = ? 
           WHERE id = ?`,
          [visitor_name, visitor_phone || 'N/A', purpose || 'Walk-in', hostId, guestId]
        );
      }
    } else {
      // Auto-heal: try with approval_status, fallback without if column missing
      try {
        const [guestResult] = await db.execute(
          `INSERT INTO guests (name, phone, purpose, host_id, qr_code, valid_from, valid_to, approval_status)
           VALUES (?, ?, ?, ?, CONCAT('manual_', UNIX_TIMESTAMP()), NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY), 'pending')`,
          [visitor_name, visitor_phone || 'N/A', purpose || 'Walk-in', hostId]
        );
        guestId = guestResult.insertId;
      } catch (colErr) {
        if (colErr.code === 'ER_BAD_FIELD_ERROR') {
          // Column doesn't exist yet — add it and retry
          console.log('[Auto-Heal] Adding approval_status column to guests...');
          try {
            await db.execute(`ALTER TABLE guests ADD COLUMN approval_status ENUM('pending','approved','denied','expired') DEFAULT 'approved'`);
          } catch (e) { /* already exists */ }
          const [guestResult] = await db.execute(
            `INSERT INTO guests (name, phone, purpose, host_id, qr_code, valid_from, valid_to, approval_status)
             VALUES (?, ?, ?, ?, CONCAT('manual_', UNIX_TIMESTAMP()), NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY), 'pending')`,
            [visitor_name, visitor_phone || 'N/A', purpose || 'Walk-in', hostId]
          );
          guestId = guestResult.insertId;
        } else throw colErr;
      }
    }


    // 3. Insert into entry_logs table so it shows up in Resident's activity logs!
    const insertLog = async () => {
      return db.execute(
        `INSERT INTO entry_logs (entity_type, entity_id, entry_time, gate_number, guard_id, vehicle_number)
         VALUES ('guest', ?, NOW(), 'Gate 1', ?, ?)`,
        [guestId, guard_id || null, vehicle_number || null]
      );
    };

    try {
      await insertLog();
    } catch (dbErr) {
      if (dbErr.code === 'ER_BAD_FIELD_ERROR' && dbErr.message.includes('vehicle_number')) {
        console.log('[Auto-Heal] Adding vehicle_number column during manual-log...');
        try {
          await db.execute('ALTER TABLE entry_logs ADD COLUMN vehicle_number VARCHAR(20) DEFAULT NULL');
          await insertLog();
        } catch (e) {
          console.error('[Auto-Heal] Failed to alter and retry, inserting without vehicle_number:', e);
          await db.execute(
            `INSERT INTO entry_logs (entity_type, entity_id, entry_time, gate_number, guard_id)
             VALUES ('guest', ?, NOW(), 'Gate 1', ?)`,
            [guestId, guard_id || null]
          );
        }
      } else {
        throw dbErr;
      }
    }

    // 4. 🔔 Emit VISITOR_NOTIFICATION (full-screen call modal) to Resident's flat room!
    const io = req.app.get('io');
    if (io && flat_number) {
      const roomName = `society_${residentSocietyId}_flat_${tower ? tower + '-' : ''}${flat_number}`;
      io.to(roomName).emit('entry_log_created');
      
      if (!existingGuest) {
        // Only trigger full-screen calling modal if it's a new direct manual log (not already approved)
        io.to(roomName).emit('visitor_notification', {
          guest_id: guestId,
          name: visitor_name,
          phone: visitor_phone || null,
          purpose: purpose || 'Walk-in',
          flat_number,
          tower: tower || null
        });
      } else {
        // If already approved, show a nice check-in toast to the resident!
        io.to(roomName).emit('visitor_checked_in', {
          visitor_name
        });
      }
    }

    // 🔔 Web Push + In-App Notif — Resident ko visitor entry notification
    if (flat_number) {
      if (!existingGuest) {
        // Full-screen calling notification
        await sendPushToFlat(
          tower, flat_number,
          `🚪 Visitor Aaya!`,
          `${visitor_name} gate par hain. Purpose: ${purpose || 'Walk-in'} — Tap karke approve/deny karein`,
          { url: `/?pending_visitor=${guestId}`, type: 'visitor', flat_number, society_id: residentSocietyId, guest_id: guestId, visitor_name, purpose: purpose || 'Walk-in' }
        );
      } else {
        // Standard check-in notification (non-calling)
        await sendPushToFlat(
          tower, flat_number,
          `🚪 Entry Approved!`,
          `${visitor_name} ne society mein ENTRY ki hai.`,
          { url: `/`, type: 'entry', flat_number, society_id: residentSocietyId }
        );
      }
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
  const { entity_type, entity_id, guard_id, vehicle_number } = req.body;
  if (!entity_type || !entity_id) return res.status(400).json({ message: 'entity_type and entity_id required' });

  try {
    // Check if already checked-in and not checked-out
    const [existing] = await db.execute(
      `SELECT id FROM entry_logs WHERE entity_type = ? AND entity_id = ? AND exit_time IS NULL`,
      [entity_type, entity_id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Visitor is already checked in!' });
    }

    // 1. Insert into entry_logs table
    const insertPreapprovedLog = async () => {
      return db.execute(
        `INSERT INTO entry_logs (entity_type, entity_id, entry_time, gate_number, guard_id, vehicle_number)
         VALUES (?, ?, NOW(), 'Gate 1', ?, ?)`,
        [entity_type, entity_id, guard_id || null, vehicle_number || null]
      );
    };

    try {
      await insertPreapprovedLog();
    } catch (dbErr) {
      if (dbErr.code === 'ER_BAD_FIELD_ERROR' && dbErr.message.includes('vehicle_number')) {
        console.log('[Auto-Heal] Adding vehicle_number column during log-preapproved...');
        try {
          await db.execute('ALTER TABLE entry_logs ADD COLUMN vehicle_number VARCHAR(20) DEFAULT NULL');
          await insertPreapprovedLog();
        } catch (e) {
          console.error('[Auto-Heal] Failed to alter and retry, inserting without vehicle_number:', e);
          await db.execute(
            `INSERT INTO entry_logs (entity_type, entity_id, entry_time, gate_number, guard_id)
             VALUES (?, ?, NOW(), 'Gate 1', ?)`,
            [entity_type, entity_id, guard_id || null]
          );
        }
      } else {
        throw dbErr;
      }
    }

    // 2. If it is a delivery, update delivery status to 'arrived' or 'completed'
    if (entity_type === 'delivery') {
      await db.execute(
        `UPDATE deliveries SET status = 'arrived' WHERE id = ?`,
        [entity_id]
      );
    }

    // 3. Query flat_number and visitor name to emit socket to the target resident's flat room!
    let tower = '';
    let flat_number = '';
    let visitor_name = 'Visitor';
    let society_id = null;
    if (entity_type === 'guest') {
      const [rows] = await db.execute(
        `SELECT u.tower, u.flat_number, g.name, u.society_id FROM guests g JOIN users u ON g.host_id = u.id WHERE g.id = ?`,
        [entity_id]
      );
      tower = rows[0]?.tower || '';
      flat_number = rows[0]?.flat_number || '';
      visitor_name = rows[0]?.name || 'Guest';
      society_id = rows[0]?.society_id || null;
    } else if (entity_type === 'delivery') {
      const [rows] = await db.execute(
        `SELECT u.tower, u.flat_number, d.company, u.society_id FROM deliveries d JOIN users u ON d.resident_id = u.id WHERE d.id = ?`,
        [entity_id]
      );
      tower = rows[0]?.tower || '';
      flat_number = rows[0]?.flat_number || '';
      visitor_name = rows[0]?.company || 'Delivery';
      society_id = rows[0]?.society_id || null;
    }

    if (flat_number) {
      const io = req.app.get('io');
      if (io) {
        const roomName = `society_${society_id}_flat_${tower ? tower + '-' : ''}${flat_number}`;
        io.to(roomName).emit('entry_log_created');
        io.to(roomName).emit('visitor_checked_in', {
          visitor_name: visitor_name
        });
      }

      // 🔔 Web Push + In-App Notif — Resident ko pre-approved entry notification
      const notifTitle = entity_type === 'delivery' ? `📦 Delivery Aayi!` : `✅ Visitor Checked In`;
      const notifMsg = `${visitor_name} society mein enter kar gaye hain.`;
      // sendPushToFlat already inserts into in_app_notifications — no need for separate saveNotifForFlat
      await sendPushToFlat(tower, flat_number, notifTitle, notifMsg, { url: '/', type: entity_type === 'delivery' ? 'delivery' : 'checkin', flat_number, society_id });
    }

    res.status(201).json({ message: 'Pre-approved entry logged successfully' });
  } catch (err) {
    console.error('Pre-approved log error:', err);
    res.status(500).json({ message: 'Failed to log entry', error: err.message });
  }
});

// GET /api/entry/logs
// Get recent entry logs for manager/guard view, filtered by society_id
router.get('/logs', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    // Get logged-in user's society_id
    const [userRows] = await db.execute('SELECT society_id FROM users WHERE id = ?', [userId]);
    const societyId = userRows[0]?.society_id || 1;

    const [rows] = await db.execute(`
      SELECT 
        el.id, el.entity_type, el.entry_time, el.exit_time, el.gate_number, el.vehicle_number,
        CASE 
          WHEN el.entity_type = 'guest' THEN g.name
          WHEN el.entity_type = 'vehicle' THEN v.vehicle_number
          WHEN el.entity_type = 'staff' THEN s.name
          ELSE 'Unknown'
        END AS entity_name,
        CASE 
          WHEN el.entity_type = 'guest' THEN ug.tower
          WHEN el.entity_type = 'vehicle' THEN uv.tower
          ELSE NULL
        END AS tower,
        CASE 
          WHEN el.entity_type = 'guest' THEN ug.flat_number
          WHEN el.entity_type = 'vehicle' THEN uv.flat_number
          ELSE 'N/A'
        END AS flat_number,
        gu.name AS guard_name
      FROM entry_logs el
      LEFT JOIN guests g ON el.entity_type = 'guest' AND el.entity_id = g.id
      LEFT JOIN users ug ON g.host_id = ug.id
      LEFT JOIN vehicles v ON el.entity_type = 'vehicle' AND el.entity_id = v.id
      LEFT JOIN users uv ON v.user_id = uv.id
      LEFT JOIN staff s ON el.entity_type = 'staff' AND el.entity_id = s.id
      LEFT JOIN users gu ON el.guard_id = gu.id
      WHERE COALESCE(ug.society_id, uv.society_id, gu.society_id) = ?
      ORDER BY el.entry_time DESC
      LIMIT 100
    `, [societyId]);
    res.json(rows);
  } catch (err) {
    console.error('Entry Logs Error:', err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// GET /api/entry/resident-logs
// Get entry logs specifically for the logged-in resident's flat number (guests, vehicles, and deliveries)
router.get('/resident-logs', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // 1. Fetch tower and flat_number for the logged-in user
    const [userRows] = await db.execute('SELECT tower, flat_number FROM users WHERE id = ?', [userId]);
    const tower = userRows[0]?.tower;
    const flatNumber = userRows[0]?.flat_number;

    if (!flatNumber) {
      return res.json([]);
    }

    const runQueries = async () => {
      // 2. Fetch Guests matching tower and flat_number
      const [guests] = await db.execute(`
        SELECT g.id, 'Guest' as type, g.name, g.purpose, g.created_at, el.entry_time, el.exit_time, el.vehicle_number
        FROM guests g
        JOIN users u ON g.host_id = u.id
        LEFT JOIN entry_logs el ON el.entity_type = 'guest' AND el.entity_id = g.id
        WHERE COALESCE(u.tower, '') = CAST(? AS CHAR) AND u.flat_number = ?
        ORDER BY g.created_at DESC LIMIT 15
      `, [tower || '', flatNumber]);

      // 3. Fetch Vehicles matching tower and flat_number
      const [vehicles] = await db.execute(`
        SELECT v.id, 'Vehicle' as type, v.vehicle_number as name, v.type as purpose, el.entry_time, el.exit_time, el.entry_time as created_at, el.vehicle_number
        FROM vehicles v
        JOIN users u ON v.user_id = u.id
        JOIN entry_logs el ON el.entity_type = 'vehicle' AND el.entity_id = v.id
        WHERE COALESCE(u.tower, '') = CAST(? AS CHAR) AND u.flat_number = ?
        ORDER BY el.entry_time DESC LIMIT 15
      `, [tower || '', flatNumber]);

      // 4. Fetch Deliveries matching tower and flat_number
      const [deliveries] = await db.execute(`
        SELECT d.id, 'Delivery' as type, d.company as name, d.status as purpose, d.created_at, COALESCE(el.entry_time, d.created_at) as entry_time, el.exit_time, el.vehicle_number
        FROM deliveries d
        JOIN users u ON d.resident_id = u.id
        LEFT JOIN entry_logs el ON el.entity_type = 'delivery' AND el.entity_id = d.id
        WHERE COALESCE(u.tower, '') = CAST(? AS CHAR) AND u.flat_number = ?
        ORDER BY d.created_at DESC LIMIT 15
      `, [tower || '', flatNumber]);

      return { guests, vehicles, deliveries };
    };

    try {
      const { guests, vehicles, deliveries } = await runQueries();
      const logs = [...guests, ...vehicles, ...deliveries].sort((a, b) => {
        const timeA = new Date(a.entry_time || a.created_at).getTime();
        const timeB = new Date(b.entry_time || b.created_at).getTime();
        return timeB - timeA;
      });
      res.json(logs);
    } catch (dbErr) {
      if (dbErr.code === 'ER_BAD_FIELD_ERROR' && dbErr.message.includes('vehicle_number')) {
        console.log('[Auto-Heal] Column "vehicle_number" is missing in "entry_logs". Adding it...');
        try {
          await db.execute('ALTER TABLE entry_logs ADD COLUMN vehicle_number VARCHAR(20) DEFAULT NULL');
          const { guests, vehicles, deliveries } = await runQueries();
          const logs = [...guests, ...vehicles, ...deliveries].sort((a, b) => {
            const timeA = new Date(a.entry_time || a.created_at).getTime();
            const timeB = new Date(b.entry_time || b.created_at).getTime();
            return timeB - timeA;
          });
          return res.json(logs);
        } catch (alterErr) {
          console.error('[Auto-Heal] Failed to add column:', alterErr);
        }
      }
      console.log('[Fallback] Returning empty logs due to DB discrepancy');
      res.json([]);
    }
  } catch (err) {
    console.error('Resident Logs Error:', err);
    res.json([]);
  }
});

// GET /api/entry/emergencies
// Get active emergency SOS list
router.get('/emergencies', async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT e.*, u.name AS user_name, u.tower, u.flat_number, u.phone
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
      SELECT id, 'guest' AS type, name, phone, purpose, DATE_FORMAT(valid_to, '%Y-%m-%d %H:%i:%s') AS valid_date, qr_code
      FROM guests WHERE host_id = ? AND valid_to >= DATE_SUB(NOW(), INTERVAL 3 DAY)
    `, [userId]);

    const [deliveries] = await db.execute(`
      SELECT id, 'delivery' AS type, company AS company, 'Delivery' AS purpose, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS valid_date, NULL AS qr_code
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
      let validTo;
      if (valid_date) {
        if (valid_date.includes('T')) {
          validTo = valid_date.replace('T', ' ');
        } else if (valid_date.includes(':')) {
          validTo = valid_date;
        } else {
          validTo = `${valid_date} 23:59:59`;
        }
      } else {
        validTo = new Date(Date.now() + 86400000).toISOString().slice(0, 19).replace('T', ' ');
      }
      
      // Generate a 4-digit numeric PIN
      const pin = Math.floor(1000 + Math.random() * 9000).toString();
      const [result] = await db.execute(
        `INSERT INTO guests (name, phone, purpose, host_id, qr_code, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
        [name, phone || '', purpose || 'Guest', userId, pin, validTo]
      );
      insertId = result.insertId;
    }

    const io = req.app.get('io');
    if (io) {
      // Get user flat
      const [user] = await db.execute('SELECT tower, flat_number FROM users WHERE id = ?', [userId]);
      const tower = user[0]?.tower || '';
      const flat = user[0]?.flat_number || '';
      const flatCombined = `${tower ? tower + '-' : ''}${flat}`;
      io.to('guard_room').emit('new_pre_approval', {
        message: `Naya Pre-Approval Aaya Hai: Flat ${flatCombined} se ${type === 'delivery' ? company : name} ke liye.`,
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

// GET /api/entry/society-contacts
// Get active security guards and emergency helplines for the society
router.get('/society-contacts', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const [userRows] = await db.execute('SELECT society_id FROM users WHERE id = ?', [userId]);
    const societyId = userRows[0]?.society_id || 1;

    // Fetch active guards for this society, including their live online status
    const [guards] = await db.execute(`
      SELECT id, name, phone, is_online FROM users
      WHERE role = 'guard' AND society_id = ? AND account_status = 'active'
    `, [societyId]);

    // Fetch custom emergency contacts for this society from the database
    const [customContacts] = await db.execute(`
      SELECT name, phone, category FROM emergency_contacts
      WHERE society_id = ?
      ORDER BY priority ASC, name ASC
    `, [societyId]);

    // Fallback to general helplines if none configured in db
    let helplines = customContacts;
    if (helplines.length === 0) {
      helplines = [
        { name: 'Main Gate Security Office 🛡️', phone: '022-4918233', category: 'Security' },
        { name: 'Society Management Helpdesk 🏢', phone: '9876543209', category: 'Committee' },
        { name: 'Fire Station 🚨', phone: '101', category: 'Fire Brigade' },
        { name: 'Ambulance Support 🚑', phone: '102', category: 'Ambulance' }
      ];
    }

    res.json({ guards, helplines });
  } catch (err) {
    console.error('Society contacts error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// GET /api/entry/pending-visitor
// Resident ka app open hone par check karo — koi visitor gate pe wait kar raha hai kya?
// Returns the most recent 'pending' visitor for this resident's flat (within last 15 min)
router.get('/pending-visitor', verifyToken, async (req, res) => {
  const { flat_number, tower } = req.user;
  if (!flat_number) return res.json({ visitor: null });

  try {
    const [rows] = await db.execute(
      `SELECT g.id AS guest_id, g.name, g.phone, g.purpose, g.approval_status, g.created_at
       FROM guests g
       JOIN users u ON g.host_id = u.id
       WHERE COALESCE(u.tower, '') = CAST(? AS CHAR)
         AND u.flat_number = ?
         AND u.society_id = ?
         AND g.approval_status = 'pending'
         AND g.created_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)
       ORDER BY g.created_at DESC
       LIMIT 1`,
      [tower || '', flat_number, req.user.society_id || null]
    );

    if (rows.length === 0) return res.json({ visitor: null });

    res.json({
      visitor: {
        guest_id: rows[0].guest_id,
        name: rows[0].name,
        phone: rows[0].phone,
        purpose: rows[0].purpose,
        created_at: rows[0].created_at
      }
    });
  } catch (err) {
    console.error('Pending visitor check error:', err.message);
    res.json({ visitor: null }); // Always return safely — don't break app load
  }
});

// PUT /api/entry/resolve-visitor/:id
// Resident approves or denies the pending visitor (from modal when app opens via push tap)
router.put('/resolve-visitor/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { decision } = req.body; // 'approved' or 'denied'
  if (!decision) return res.status(400).json({ message: 'decision required (approved/denied)' });

  try {
    await db.execute(
      `UPDATE guests SET approval_status = ? WHERE id = ? AND approval_status = 'pending'`,
      [decision, id]
    );

    // Notify guard of the decision via socket
    const io = req.app.get('io');
    if (io) {
      const [gRows] = await db.execute(`SELECT name FROM guests WHERE id = ?`, [id]);
      io.to('guard_room').emit('visitor_decision_result', {
        approved: decision === 'approved',
        tower: req.user.tower,
        flat_number: req.user.flat_number,
        visitor_name: gRows[0]?.name || 'Visitor',
        guest_id: id
      });
    }

    res.json({ message: `Visitor ${decision}` });
  } catch (err) {
    console.error('Resolve visitor error:', err.message);
    res.status(500).json({ message: 'Server Error' });
  }
});

module.exports = router;


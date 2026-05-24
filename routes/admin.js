const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../config/db');
const { verifyToken, authorizeRoles, roles } = require('../middlewares/auth');

// All admin routes require authentication + admin or super_admin role
router.use(verifyToken);
router.use(authorizeRoles(roles.ADMIN, roles.SUPER_ADMIN));

// ── GET Admin Dashboard Stats ────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const societyId = req.user.society_id;

    const [[societyRow]] = await db.execute(
      `SELECT s.name, s.society_code, s.city, s.address,
        COUNT(DISTINCT CASE WHEN u.role IN ('resident_primary','resident_family') AND u.account_status='active' THEN u.id END) AS residents,
        COUNT(DISTINCT CASE WHEN u.role = 'guard' THEN u.id END) AS guards,
        COUNT(DISTINCT CASE WHEN u.role = 'manager' THEN u.id END) AS managers,
        COUNT(DISTINCT CASE WHEN u.role = 'technician' THEN u.id END) AS technicians,
        COUNT(DISTINCT CASE WHEN u.account_status = 'pending' THEN u.id END) AS pending_approvals
      FROM societies s
      LEFT JOIN users u ON u.society_id = s.id
      WHERE s.id = ?
      GROUP BY s.id`,
      [societyId]
    );

    const [[ticketRow]] = await db.execute(
      `SELECT 
        COUNT(*) AS total_tickets,
        SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END) AS open_tickets,
        SUM(CASE WHEN status = 'Resolved' THEN 1 ELSE 0 END) AS resolved_tickets
      FROM service_requests sr
      JOIN users u ON sr.user_id = u.id
      WHERE u.society_id = ?`,
      [societyId]
    );

    const [[entryRow]] = await db.execute(
      `SELECT COUNT(*) AS today_entries
      FROM entry_logs el
      JOIN users gu ON el.guard_id = gu.id
      WHERE gu.society_id = ? AND DATE(el.entry_time) = CURDATE()`,
      [societyId]
    );

    res.json({
      society: societyRow || {},
      stats: {
        residents: societyRow?.residents || 0,
        guards: societyRow?.guards || 0,
        managers: societyRow?.managers || 0,
        technicians: societyRow?.technicians || 0,
        pending_approvals: societyRow?.pending_approvals || 0,
        total_tickets: ticketRow?.total_tickets || 0,
        open_tickets: ticketRow?.open_tickets || 0,
        resolved_tickets: ticketRow?.resolved_tickets || 0,
        today_entries: entryRow?.today_entries || 0,
      }
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── GET All Managers in Admin's Society ──────────────────────
router.get('/managers', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT u.id, u.name, u.phone, u.account_status, u.created_at, s.name AS society_name
       FROM users u
       LEFT JOIN societies s ON u.society_id = s.id
       WHERE u.role = 'manager' AND u.society_id = ?
       ORDER BY u.created_at DESC`,
      [req.user.society_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── POST Create Manager in Admin's Society ───────────────────
router.post('/create-manager', async (req, res) => {
  const { name, phone, password } = req.body;
  if (!name || !phone) return res.status(400).json({ message: 'Name and phone required' });
  try {
    const pwd = password || '123456';
    const password_hash = await bcrypt.hash(pwd, 10);
    const [result] = await db.execute(
      `INSERT INTO users (name, phone, password_hash, role, account_status, society_id) VALUES (?, ?, ?, 'manager', 'active', ?)`,
      [name, phone, password_hash, req.user.society_id]
    );
    res.status(201).json({ message: 'Manager created successfully', userId: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'Phone number already registered' });
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── DELETE Manager in Admin's Society ───────────────────────
router.delete('/managers/:id', async (req, res) => {
  try {
    await db.execute(
      `DELETE FROM users WHERE id = ? AND role = 'manager' AND society_id = ?`,
      [req.params.id, req.user.society_id]
    );
    res.json({ message: 'Manager removed successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── GET All Staff in Admin's Society ─────────────────────────
router.get('/staff', async (req, res) => {
  try {
    const [systemStaff] = await db.execute(
      `SELECT id, name, phone, role, created_at FROM users 
       WHERE role IN ('guard', 'technician') AND society_id = ? ORDER BY name`,
      [req.user.society_id]
    );
    const [externalStaff] = await db.execute(`SELECT id, name, phone, role, qr_code, created_at FROM staff ORDER BY name`);
    res.json({ systemStaff, externalStaff });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── POST Create Staff in Admin's Society ─────────────────────
router.post('/create-staff', async (req, res) => {
  const { name, phone, role, password } = req.body;
  if (!name || !phone || !role) return res.status(400).json({ message: 'name, phone, role required' });
  try {
    if (['guard', 'technician'].includes(role)) {
      const pwd = password || '123456';
      const password_hash = await bcrypt.hash(pwd, 10);
      const [result] = await db.execute(
        `INSERT INTO users (name, phone, password_hash, role, account_status, society_id) VALUES (?, ?, ?, ?, 'active', ?)`,
        [name, phone, password_hash, role, req.user.society_id]
      );
      res.status(201).json({ message: `${role} created successfully`, userId: result.insertId });
    } else {
      const qr_code = `staff_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
      const [result] = await db.execute(
        `INSERT INTO staff (name, phone, role, qr_code) VALUES (?, ?, ?, ?)`,
        [name, phone, role, qr_code]
      );
      res.status(201).json({ message: `${role} created successfully`, staffId: result.insertId, qr_code });
    }
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'Phone already in use' });
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── GET All Residents in Admin's Society ─────────────────────
router.get('/residents', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, name, phone, tower, flat_number, role, account_status, created_at FROM users
       WHERE role IN ('resident_primary', 'resident_family') AND society_id = ?
       ORDER BY tower, flat_number`,
      [req.user.society_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── GET Recent Entry Logs for Admin's Society ─────────────────
router.get('/entry-logs', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT el.id, el.entity_type, el.entry_time, el.exit_time, el.gate_number,
        CASE 
          WHEN el.entity_type = 'guest' THEN g.name
          WHEN el.entity_type = 'vehicle' THEN v.vehicle_number
          WHEN el.entity_type = 'staff' THEN s.name
          ELSE 'Unknown'
        END AS entity_name,
        gu.name AS guard_name, gu.flat_number
      FROM entry_logs el
      LEFT JOIN guests g ON el.entity_type = 'guest' AND el.entity_id = g.id
      LEFT JOIN vehicles v ON el.entity_type = 'vehicle' AND el.entity_id = v.id
      LEFT JOIN staff s ON el.entity_type = 'staff' AND el.entity_id = s.id
      LEFT JOIN users gu ON el.guard_id = gu.id
      WHERE gu.society_id = ?
      ORDER BY el.entry_time DESC LIMIT 100`,
      [req.user.society_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── GET Pending Residents in Admin's Society ──────────────────
router.get('/pending-residents', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, name, phone, tower, flat_number, created_at FROM users 
       WHERE account_status = 'pending' AND society_id = ? ORDER BY created_at DESC`,
      [req.user.society_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── POST Approve/Reject Resident ─────────────────────────────
router.post('/approve-resident', async (req, res) => {
  const { userId, status } = req.body;
  if (!['active', 'rejected'].includes(status)) return res.status(400).json({ message: 'Invalid status' });
  try {
    const [result] = await db.execute(
      `UPDATE users SET account_status = ? WHERE id = ? AND society_id = ? AND role IN ('resident_primary', 'resident_family')`,
      [status, userId, req.user.society_id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Resident not found in your society' });
    const io = req.app.get('io');
    const [residentRows] = await db.execute(`SELECT tower, flat_number, name FROM users WHERE id = ?`, [userId]);
    if (residentRows.length > 0 && io) {
      const { tower, flat_number, name } = residentRows[0];
      const roomName = `flat_${tower ? tower + '-' : ''}${flat_number}`;
      io.to(roomName).emit('account_status_update', { status, name });
    }
    res.json({ message: `Resident ${status}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── GET Emergency Contacts for Admin's Society ────────────────
router.get('/emergency-contacts', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT * FROM emergency_contacts WHERE society_id = ? ORDER BY priority ASC, name ASC`,
      [req.user.society_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

module.exports = router;

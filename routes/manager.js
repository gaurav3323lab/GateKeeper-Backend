const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../config/db');
const { verifyToken, authorizeRoles, roles } = require('../middlewares/auth');
const { sendPushToUser } = require('../utils/sendPush');

// Apply middleware to all manager routes
router.use(verifyToken);
router.use(authorizeRoles(roles.MANAGER, roles.ADMIN, roles.SUPER_ADMIN));

// ── Approve / Reject a Resident ─────────────────────────────
router.post('/approve-resident', async (req, res) => {
  const { userId, status } = req.body;
  if (!['active', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status.' });
  }

  try {
    const [result] = await db.execute(
      `UPDATE users SET account_status = ? WHERE id = ? AND role IN ('resident_primary', 'resident_family')`,
      [status, userId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Resident not found' });
    }

    // ✅ Emit socket notification to the resident's flat
    const [residentRows] = await db.execute(
      `SELECT flat_number, name FROM users WHERE id = ?`, [userId]
    );
    if (residentRows.length > 0) {
      const io = req.app.get('io');
      const { flat_number, name } = residentRows[0];
      if (io && flat_number) {
        io.to(`flat_${flat_number}`).emit('account_status_update', {
          status,
          message: status === 'active'
            ? `Aapka account approve ho gaya! Ab aap login kar sakte hain.`
            : `Aapki registration reject ho gayi hai. Manager se contact karein.`,
          name
        });
      }

      // 🔔 Web Push — Resident ko direct OS notification
      await sendPushToUser(
        userId,
        status === 'active' ? '✅ Account Approved!' : '❌ Registration Rejected',
        status === 'active'
          ? `Namaste ${name}! Aapka GateKeeper account activate ho gaya hai. Ab login karein.`
          : `Aapki registration abhi accept nahi hui. Society manager se milein.`,
        { url: '/', type: 'approval', status }
      );
    }

    res.json({ message: `Resident account marked as ${status}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── Create Staff (Guards, Technicians, Maids) ────────────────
router.post('/create-staff', async (req, res) => {
  const { name, phone, role, password } = req.body;
  if (!name || !phone || !role) return res.status(400).json({ message: 'name, phone, role required' });

  try {
    // Use JWT society_id — no DB lookup needed
    const societyId = req.user.society_id || 1;

    if (['guard', 'technician'].includes(role)) {
      const pwd = password || '123456';
      const password_hash = await bcrypt.hash(pwd, 10);
      const [result] = await db.execute(
        `INSERT INTO users (name, phone, password_hash, role, account_status, society_id) VALUES (?, ?, ?, ?, 'active', ?)`,
        [name, phone, password_hash, role, societyId]
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
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'Phone number already in use' });
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── Create Manager (Super Admin only) ───────────────────────
router.post('/create-manager', async (req, res) => {
  const { name, phone, password, society_id } = req.body;
  if (!name || !phone) return res.status(400).json({ message: 'name and phone required' });

  try {
    const pwd = password || '123456';
    const password_hash = await bcrypt.hash(pwd, 10);
    const [result] = await db.execute(
      `INSERT INTO users (name, phone, password_hash, role, account_status, society_id) VALUES (?, ?, ?, 'manager', 'active', ?)`,
      [name, phone, password_hash, society_id || null]
    );
    res.status(201).json({ message: 'Manager created successfully', userId: result.insertId });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'Phone number already registered' });
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── Get All Managers (Super Admin) ───────────────────────────
router.get('/managers', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT u.id, u.name, u.phone, u.account_status, u.created_at, s.name AS society_name
       FROM users u
       LEFT JOIN societies s ON u.society_id = s.id
       WHERE u.role = 'manager'
       ORDER BY u.created_at DESC`
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── Get Pending Residents (Society Filtered) ──────────────────
router.get('/pending-residents', async (req, res) => {
  try {
    // super_admin sees all, others see only their society
    const isSuperAdmin = req.user.role === 'super_admin';
    const query = isSuperAdmin
      ? `SELECT id, name, phone, flat_number, created_at FROM users WHERE account_status = 'pending' ORDER BY created_at DESC`
      : `SELECT id, name, phone, flat_number, created_at FROM users WHERE account_status = 'pending' AND society_id = ? ORDER BY created_at DESC`;
    const params = isSuperAdmin ? [] : [req.user.society_id];
    const [users] = await db.execute(query, params);
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── Get All Residents (Society Filtered) ─────────────────────
router.get('/residents', async (req, res) => {
  try {
    const isSuperAdmin = req.user.role === 'super_admin';
    const query = isSuperAdmin
      ? `SELECT id, name, phone, flat_number, role, account_status, created_at FROM users WHERE role IN ('resident_primary', 'resident_family') AND account_status = 'active' ORDER BY flat_number`
      : `SELECT id, name, phone, flat_number, role, account_status, created_at FROM users WHERE role IN ('resident_primary', 'resident_family') AND account_status = 'active' AND society_id = ? ORDER BY flat_number`;
    const params = isSuperAdmin ? [] : [req.user.society_id];
    const [rows] = await db.execute(query, params);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── Get Staff (Society Filtered) ─────────────────────────────
router.get('/staff', async (req, res) => {
  try {
    const isSuperAdmin = req.user.role === 'super_admin';
    const staffQuery = isSuperAdmin
      ? `SELECT id, name, phone, role, created_at FROM users WHERE role IN ('guard', 'technician') ORDER BY name`
      : `SELECT id, name, phone, role, created_at FROM users WHERE role IN ('guard', 'technician') AND society_id = ? ORDER BY name`;
    const staffParams = isSuperAdmin ? [] : [req.user.society_id];
    const [systemStaff] = await db.execute(staffQuery, staffParams);
    const [externalStaff] = await db.execute(`SELECT id, name, phone, role, qr_code, created_at FROM staff ORDER BY name`);
    res.json({ systemStaff, externalStaff });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── Update Staff ─────────────────────────────────────────────
router.put('/staff/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  const { name, phone, role, password } = req.body;
  try {
    if (type === 'system') {
      if (password) {
        const password_hash = await bcrypt.hash(password, 10);
        await db.execute(
          `UPDATE users SET name = ?, phone = ?, role = ?, password_hash = ? WHERE id = ? AND role IN ('guard', 'technician')`,
          [name, phone, role, password_hash, id]
        );
      } else {
        await db.execute(
          `UPDATE users SET name = ?, phone = ?, role = ? WHERE id = ? AND role IN ('guard', 'technician')`,
          [name, phone, role, id]
        );
      }
    } else {
      await db.execute(`UPDATE staff SET name = ?, phone = ?, role = ? WHERE id = ?`, [name, phone, role, id]);
    }
    res.json({ message: 'Staff updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── Delete Staff ─────────────────────────────────────────────
router.delete('/staff/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  try {
    if (type === 'system') {
      await db.execute(`DELETE FROM users WHERE id = ? AND role IN ('guard', 'technician')`, [id]);
    } else {
      await db.execute(`DELETE FROM staff WHERE id = ?`, [id]);
    }
    res.json({ message: 'Staff removed successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── Delete Manager ───────────────────────────────────────────
router.delete('/managers/:id', async (req, res) => {
  try {
    await db.execute(`DELETE FROM users WHERE id = ? AND role = 'manager'`, [req.params.id]);
    res.json({ message: 'Manager removed successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── Emergency Contacts CRUD ───────────────────────────────────

// GET all emergency contacts for this society
router.get('/emergency-contacts', async (req, res) => {
  try {
    const societyId = req.user.society_id;
    const [rows] = await db.execute(
      `SELECT * FROM emergency_contacts WHERE society_id = ? ORDER BY priority ASC, name ASC`,
      [societyId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Emergency contacts fetch error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// POST create new emergency contact
router.post('/emergency-contacts', async (req, res) => {
  const { name, phone, category, priority } = req.body;
  if (!name || !phone || !category) return res.status(400).json({ message: 'Name, phone, and category are required' });
  try {
    const societyId = req.user.society_id;
    const [result] = await db.execute(
      `INSERT INTO emergency_contacts (society_id, name, phone, category, priority) VALUES (?, ?, ?, ?, ?)`,
      [societyId, name, phone, category, priority || 5]
    );
    res.status(201).json({ message: 'Emergency contact added', id: result.insertId });
  } catch (err) {
    console.error('Emergency contact create error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// PUT update emergency contact
router.put('/emergency-contacts/:id', async (req, res) => {
  const { name, phone, category, priority } = req.body;
  try {
    await db.execute(
      `UPDATE emergency_contacts SET name = ?, phone = ?, category = ?, priority = ? WHERE id = ? AND society_id = ?`,
      [name, phone, category, priority || 5, req.params.id, req.user.society_id]
    );
    res.json({ message: 'Contact updated' });
  } catch (err) {
    console.error('Emergency contact update error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// DELETE emergency contact
router.delete('/emergency-contacts/:id', async (req, res) => {
  try {
    await db.execute(
      `DELETE FROM emergency_contacts WHERE id = ? AND society_id = ?`,
      [req.params.id, req.user.society_id]
    );
    res.json({ message: 'Contact deleted' });
  } catch (err) {
    console.error('Emergency contact delete error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

module.exports = router;

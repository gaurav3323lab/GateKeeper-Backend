const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken, authorizeRoles, roles } = require('../middlewares/auth');

// ✅ Fixed: Protected routes — only super_admin or manager can modify societies
router.get('/', async (req, res) => {
  try {
    // Public GET for registration dropdown — no auth needed
    const [rows] = await db.query(`
      SELECT s.id, s.name, s.society_code, s.city, s.state, s.zip_code, s.address, s.created_at,
        COUNT(DISTINCT CASE WHEN u.role IN ('resident_primary','resident_family') AND u.account_status='active' THEN u.id END) AS residents,
        COUNT(DISTINCT CASE WHEN u.role = 'guard' THEN u.id END) AS guards,
        COUNT(DISTINCT CASE WHEN u.role = 'manager' THEN u.id END) AS managers,
        COUNT(DISTINCT v.id) AS vehicles,
        (SELECT COUNT(*) FROM entry_logs el JOIN users gu ON el.guard_id = gu.id WHERE gu.society_id = s.id AND DATE(el.entry_time) = CURDATE()) AS today_entries
      FROM societies s
      LEFT JOIN users u ON u.society_id = s.id
      LEFT JOIN vehicles v ON v.user_id = u.id
      GROUP BY s.id
      ORDER BY s.created_at DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching societies:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET to verify society code (public — for registration)
router.get('/verify/:code', async (req, res) => {
  const { code } = req.params;
  try {
    const [societies] = await db.query('SELECT id, name, city FROM societies WHERE society_code = ?', [code.toUpperCase()]);
    if (societies.length === 0) return res.status(404).json({ message: 'Invalid Society PIN' });
    res.json(societies[0]);
  } catch (error) {
    console.error('Error verifying society code:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Auth required for all write routes below
router.post('/', verifyToken, authorizeRoles(roles.SUPER_ADMIN), async (req, res) => {
  const { name, address, city, state, zip_code, society_code: custom_code } = req.body;
  if (!name || !city || !state || !zip_code) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  try {
    let society_code = custom_code ? custom_code.toUpperCase() : null;
    if (society_code) {
      const [existing] = await db.query('SELECT id FROM societies WHERE society_code = ?', [society_code]);
      if (existing.length > 0) return res.status(400).json({ message: 'This Society PIN is already in use.' });
    } else {
      const generateCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();
      society_code = generateCode();
      let [existing] = await db.query('SELECT id FROM societies WHERE society_code = ?', [society_code]);
      while (existing.length > 0) {
        society_code = generateCode();
        [existing] = await db.query('SELECT id FROM societies WHERE society_code = ?', [society_code]);
      }
    }
    const [result] = await db.query(
      'INSERT INTO societies (name, society_code, address, city, state, zip_code) VALUES (?, ?, ?, ?, ?, ?)',
      [name, society_code, address || 'N/A', city, state, zip_code]
    );
    res.status(201).json({
      message: 'Society created successfully',
      society: { id: result.insertId, name, society_code, address, city, state, zip_code }
    });
  } catch (error) {
    console.error('Error creating society:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id', verifyToken, authorizeRoles(roles.SUPER_ADMIN), async (req, res) => {
  const { id } = req.params;
  const { name, city, zip_code, society_code, state, address } = req.body;
  if (!name || !city) return res.status(400).json({ message: 'Name and city are required' });
  try {
    if (society_code) {
      const [existing] = await db.query('SELECT id FROM societies WHERE society_code = ? AND id != ?', [society_code.toUpperCase(), id]);
      if (existing.length > 0) return res.status(400).json({ message: 'This PIN is already in use by another society.' });
      await db.query(
        'UPDATE societies SET name = ?, city = ?, zip_code = ?, society_code = ?, state = ?, address = ? WHERE id = ?',
        [name, city, zip_code || 'N/A', society_code.toUpperCase(), state || 'N/A', address || 'N/A', id]
      );
    } else {
      await db.query(
        'UPDATE societies SET name = ?, city = ?, zip_code = ?, state = ?, address = ? WHERE id = ?',
        [name, city, zip_code || 'N/A', state || 'N/A', address || 'N/A', id]
      );
    }
    res.json({ message: 'Society updated successfully' });
  } catch (error) {
    console.error('Error updating society:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/:id', verifyToken, authorizeRoles(roles.SUPER_ADMIN), async (req, res) => {
  try {
    await db.query('DELETE FROM societies WHERE id = ?', [req.params.id]);
    res.json({ message: 'Society deleted successfully' });
  } catch (error) {
    console.error('Error deleting society:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

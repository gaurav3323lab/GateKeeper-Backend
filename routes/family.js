const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken } = require('../middlewares/auth');

router.use(verifyToken);

// GET — Get family members
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, name, phone, role, flat_number, created_at FROM users WHERE parent_id = ?`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// POST — Add family member
router.post('/', async (req, res) => {
  const { name, phone, relation } = req.body;
  if (!name || !phone) return res.status(400).json({ message: 'Naam aur phone required hai' });
  try {
    const [result] = await db.execute(
      `INSERT INTO users (name, phone, password_hash, role, account_status, flat_number, parent_id)
       VALUES (?, ?, 'family_default', 'resident_family', 'active', ?, ?)`,
      [name, phone, req.user.flat_number, req.user.id]
    );
    res.status(201).json({ message: 'Family member add ho gaye', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'Yeh phone number pehle se registered hai' });
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// DELETE — Remove family member
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await db.execute(
      `DELETE FROM users WHERE id = ? AND parent_id = ?`,
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Member nahi mila' });
    res.json({ message: 'Family member remove kar diya gaya' });
  } catch (err) {
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// PUT — Update family member
router.put('/:id', async (req, res) => {
  const { name, phone } = req.body; // relation is not stored in users table according to current schema
  if (!name || !phone) return res.status(400).json({ message: 'Naam aur phone required hai' });
  try {
    const [result] = await db.execute(
      `UPDATE users SET name = ?, phone = ? WHERE id = ? AND parent_id = ?`,
      [name, phone, req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Member nahi mila' });
    res.json({ message: 'Family member update ho gaya' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'Yeh phone number pehle se registered hai' });
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

module.exports = router;

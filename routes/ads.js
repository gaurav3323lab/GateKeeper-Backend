const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken, authorizeRoles, roles } = require('../middlewares/auth');

// GET /api/ads — Get ads for a society (Resident/Guard/Manager)
router.get('/', verifyToken, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT * FROM ads WHERE society_id = ? ORDER BY created_at DESC`,
      [req.user.society_id || 1] // Fallback to 1 if not set
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching ads:', error);
    res.status(500).json({ message: 'Server Error', error: error.message });
  }
});

// POST /api/ads — Create an ad (Manager/Super Admin)
router.post('/', verifyToken, authorizeRoles(roles.MANAGER, roles.SUPER_ADMIN), async (req, res) => {
  const { title, description, image_url, link, bg_color } = req.body;
  if (!title || !description) return res.status(400).json({ message: 'Title and description are required' });

  try {
    const [result] = await db.execute(
      `INSERT INTO ads (society_id, title, description, image_url, link, bg_color) VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.society_id || 1, title, description, image_url || null, link || '#', bg_color || 'from-indigo-500/20 to-purple-700/20']
    );
    res.status(201).json({ message: 'Ad created successfully', id: result.insertId });
  } catch (error) {
    console.error('Error creating ad:', error);
    res.status(500).json({ message: 'Server Error', error: error.message });
  }
});

// DELETE /api/ads/:id — Delete an ad (Manager/Super Admin)
router.delete('/:id', verifyToken, authorizeRoles(roles.MANAGER, roles.SUPER_ADMIN), async (req, res) => {
  try {
    const [result] = await db.execute(`DELETE FROM ads WHERE id = ? AND society_id = ?`, [req.params.id, req.user.society_id || 1]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Ad not found or unauthorized' });
    res.json({ message: 'Ad deleted successfully' });
  } catch (error) {
    console.error('Error deleting ad:', error);
    res.status(500).json({ message: 'Server Error', error: error.message });
  }
});

module.exports = router;

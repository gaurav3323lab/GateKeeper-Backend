const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken, authorizeRoles, roles } = require('../middlewares/auth');
const { sendPushToSociety } = require('../utils/sendPush');

// ── GET Announcements (all logged-in users) ──────────────────
router.get('/', verifyToken, async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT a.*, u.name AS author_name, u.role AS author_role
      FROM announcements a
      JOIN users u ON a.author_id = u.id
      ORDER BY a.is_pinned DESC, a.created_at DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── POST Create Announcement (Manager / Super Admin) ─────────
router.post('/', verifyToken, authorizeRoles(roles.MANAGER, roles.SUPER_ADMIN), async (req, res) => {
  const { title, body, category, is_pinned } = req.body;
  if (!title || !body) return res.status(400).json({ message: 'title and body required' });
  try {
    const [result] = await db.execute(
      `INSERT INTO announcements (title, body, category, author_id, is_pinned) VALUES (?, ?, ?, ?, ?)`,
      [title, body, category || 'General', req.user.id, is_pinned ? 1 : 0]
    );

    // Broadcast to all residents in real-time (socket)
    const io = req.app.get('io');
    if (io) {
      io.emit('new_announcement', { title, body, category: category || 'General', is_pinned: !!is_pinned });
    }

    // 🔔 Web Push — Puri society ko announcement notification
    const [userRows] = await db.execute('SELECT society_id FROM users WHERE id = ?', [req.user.id]);
    const societyId = userRows[0]?.society_id || 1;
    const categoryEmoji = { General: '📢', Maintenance: '🔧', Emergency: '🚨', Event: '🎉', Notice: '📌' };
    const emoji = categoryEmoji[category] || '📢';
    await sendPushToSociety(
      societyId,
      `${emoji} ${category || 'General'}: ${title}`,
      body.length > 80 ? body.substring(0, 80) + '...' : body,
      { url: '/', type: 'announcement' }
    );

    res.status(201).json({ message: 'Announcement posted', id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── PUT Update Announcement ───────────────────────────────────
router.put('/:id', verifyToken, authorizeRoles(roles.MANAGER, roles.SUPER_ADMIN), async (req, res) => {
  const { title, body, category, is_pinned } = req.body;
  try {
    await db.execute(
      `UPDATE announcements SET title = ?, body = ?, category = ?, is_pinned = ? WHERE id = ?`,
      [title, body, category || 'General', is_pinned ? 1 : 0, req.params.id]
    );
    res.json({ message: 'Announcement updated' });
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── DELETE Announcement ───────────────────────────────────────
router.delete('/:id', verifyToken, authorizeRoles(roles.MANAGER, roles.SUPER_ADMIN), async (req, res) => {
  try {
    await db.execute(`DELETE FROM announcements WHERE id = ?`, [req.params.id]);
    res.json({ message: 'Announcement deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

module.exports = router;

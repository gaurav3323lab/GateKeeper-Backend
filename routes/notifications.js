const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../middleware/auth');

// GET /api/notifications - Get all notifications for current user/flat
router.get('/', auth, async (req, res) => {
  try {
    const { id: user_id, role, tower, flat_number, society_id } = req.user;
    
    let query = '';
    let params = [];

    // If resident, fetch notifications for the user OR the flat OR the society
    if (role === 'resident_primary' || role === 'resident_family') {
      query = `
        SELECT * FROM in_app_notifications 
        WHERE user_id = ? 
           OR (society_id = ? AND tower = ? AND flat_number = ?)
           OR (society_id = ? AND tower IS NULL AND flat_number IS NULL AND user_id IS NULL)
        ORDER BY created_at DESC 
        LIMIT 50
      `;
      params = [user_id, society_id, tower || '', flat_number, society_id];
    } else {
      // Guard/Manager/Admin: fetch by user_id OR society-wide
      query = `
        SELECT * FROM in_app_notifications 
        WHERE user_id = ? 
           OR (society_id = ? AND tower IS NULL AND flat_number IS NULL AND user_id IS NULL)
        ORDER BY created_at DESC 
        LIMIT 50
      `;
      params = [user_id, society_id];
    }

    const [rows] = await db.execute(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Failed to fetch notifications:', err);
    res.status(500).json({ error: 'Server error fetching notifications' });
  }
});

// PUT /api/notifications/:id/read - Mark a notification as read
router.put('/:id/read', auth, async (req, res) => {
  try {
    const notifId = req.params.id;
    await db.execute('UPDATE in_app_notifications SET is_read = TRUE WHERE id = ?', [notifId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to mark notification read:', err);
    res.status(500).json({ error: 'Server error marking read' });
  }
});

// PUT /api/notifications/read-all - Mark all as read for current user
router.put('/read-all', auth, async (req, res) => {
  try {
    const { id: user_id, role, tower, flat_number, society_id } = req.user;
    
    let query = '';
    let params = [];

    if (role === 'resident_primary' || role === 'resident_family') {
      query = `
        UPDATE in_app_notifications SET is_read = TRUE
        WHERE user_id = ? 
           OR (society_id = ? AND tower = ? AND flat_number = ?)
           OR (society_id = ? AND tower IS NULL AND flat_number IS NULL AND user_id IS NULL)
      `;
      params = [user_id, society_id, tower || '', flat_number, society_id];
    } else {
      query = `
        UPDATE in_app_notifications SET is_read = TRUE
        WHERE user_id = ? 
           OR (society_id = ? AND tower IS NULL AND flat_number IS NULL AND user_id IS NULL)
      `;
      params = [user_id, society_id];
    }

    await db.execute(query, params);
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to mark all notifications read:', err);
    res.status(500).json({ error: 'Server error marking all read' });
  }
});

module.exports = router;

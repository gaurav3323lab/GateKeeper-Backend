const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken, authorizeRoles, roles } = require('../middlewares/auth');

router.use(verifyToken);

// GET — Resident gets their service requests
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT sr.*, u.name AS technician_name
       FROM service_requests sr
       LEFT JOIN users u ON sr.assigned_technician_id = u.id
       WHERE sr.user_id = ?
       ORDER BY sr.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// GET — Technician / Manager gets all open service requests
router.get('/all', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT sr.*, u.name AS resident_name, u.flat_number, t.name AS technician_name
       FROM service_requests sr
       JOIN users u ON sr.user_id = u.id
       LEFT JOIN users t ON sr.assigned_technician_id = t.id
       ORDER BY sr.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// POST — Create a service request
router.post('/', async (req, res) => {
  const { category, description, photo_url } = req.body;
  if (!category || !description) return res.status(400).json({ message: 'Category aur description required hai' });
  try {
    const [result] = await db.execute(
      `INSERT INTO service_requests (user_id, category, description, photo_url, status) VALUES (?, ?, ?, ?, 'Open')`,
      [req.user.id, category, description, photo_url || null]
    );
    res.status(201).json({ message: 'Request darj ho gayi', id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// PUT — Update status (Technician or Manager)
router.put('/:id/status', async (req, res) => {
  const { status, technician_id } = req.body;
  const validStatuses = ['Open', 'In-progress', 'Resolved'];
  if (!validStatuses.includes(status)) return res.status(400).json({ message: 'Invalid status' });
  try {
    await db.execute(
      `UPDATE service_requests SET status = ?, assigned_technician_id = COALESCE(?, assigned_technician_id), updated_at = NOW() WHERE id = ?`,
      [status, technician_id || null, req.params.id]
    );
    res.json({ message: `Status update ho gaya: ${status}` });
  } catch (err) {
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// PUT — Update a service request (Resident editing their own request)
router.put('/:id', async (req, res) => {
  const { category, description, photo_url } = req.body;
  if (!category || !description) return res.status(400).json({ message: 'Category aur description required hai' });
  try {
    const [result] = await db.execute(
      `UPDATE service_requests SET category = ?, description = ?, photo_url = COALESCE(?, photo_url), updated_at = NOW() WHERE id = ? AND user_id = ?`,
      [category, description, photo_url || null, req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Request nahi mili ya aapke paas permission nahi hai' });
    res.json({ message: 'Request update ho gayi' });
  } catch (err) {
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// DELETE — Remove a service request
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await db.execute(
      `DELETE FROM service_requests WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Request nahi mili ya aapke paas permission nahi hai' });
    res.json({ message: 'Request remove kar di gayi' });
  } catch (err) {
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

module.exports = router;

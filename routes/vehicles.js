const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken } = require('../middlewares/auth');

router.use(verifyToken);

// GET — Get all vehicles for logged-in resident
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, vehicle_number, type, brand, status, created_at FROM vehicles WHERE user_id = ?`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// POST — Add a vehicle
router.post('/', async (req, res) => {
  const { vehicle_number, type, brand } = req.body;
  if (!vehicle_number || !type) return res.status(400).json({ message: 'Number plate aur type required hai' });
  try {
    const [result] = await db.execute(
      `INSERT INTO vehicles (user_id, vehicle_number, type, brand, status) VALUES (?, ?, ?, ?, 'Outside')`,
      [req.user.id, vehicle_number.trim().toUpperCase(), type, brand || 'Other']
    );
    res.status(201).json({ message: 'Vehicle add ho gaya', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'Yeh number plate pehle se registered hai' });
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// DELETE — Remove a vehicle
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await db.execute(
      `DELETE FROM vehicles WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Vehicle nahi mila' });
    res.json({ message: 'Vehicle remove kar diya gaya' });
  } catch (err) {
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// PUT — Update a vehicle
router.put('/:id', async (req, res) => {
  const { vehicle_number, type, brand } = req.body;
  if (!vehicle_number || !type) return res.status(400).json({ message: 'Number plate aur type required hai' });
  try {
    const [result] = await db.execute(
      `UPDATE vehicles SET vehicle_number = ?, type = ?, brand = ? WHERE id = ? AND user_id = ?`,
      [vehicle_number.trim().toUpperCase(), type, brand || 'Other', req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Vehicle nahi mila' });
    res.json({ message: 'Vehicle update ho gaya' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'Yeh number plate pehle se registered hai' });
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

module.exports = router;

/**
 * GateKeeper — Database Healing & Verification Script
 * Run: node heal_db.js
 */
require('dotenv').config();
const pool = require('./config/db');

async function heal() {
  console.log('[Heal DB] Starting database healing process...');
  try {
    // 1. Create home_chores table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS home_chores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        society_id INT NOT NULL,
        tower VARCHAR(50) DEFAULT NULL,
        flat_number VARCHAR(20) NOT NULL,
        text TEXT NOT NULL,
        is_done BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('[Heal DB] Table "home_chores" verified/created successfully.');

    // 2. Add vehicle_number column to entry_logs table if not exists
    try {
      await pool.query('ALTER TABLE entry_logs ADD COLUMN vehicle_number VARCHAR(20) DEFAULT NULL');
      console.log('[Heal DB] Column "vehicle_number" added to "entry_logs" successfully.');
    } catch (err) {
      if (err.code === 'ER_DUP_COLUMN_NAME') {
        console.log('[Heal DB] Column "vehicle_number" already exists in "entry_logs".');
      } else {
        throw err;
      }
    }

    console.log('[Heal DB] Database healing completed successfully! ✅');
  } catch (err) {
    console.error('[Heal DB] Database healing failed:', err);
  } finally {
    await pool.end();
  }
}

heal();

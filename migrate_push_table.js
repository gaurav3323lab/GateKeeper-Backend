/**
 * GateKeeper — Push Table Migration Script
 * Run: node migrate_push_table.js
 */
require('dotenv').config();
const pool = require('./config/db');

async function migrate() {
  console.log('[Migration] Starting push_subscriptions table migration...');
  try {
    // 1. Modify endpoint to be nullable
    await pool.query('ALTER TABLE push_subscriptions MODIFY COLUMN endpoint TEXT NULL');
    console.log('[Migration] Column endpoint modified to NULL successfully.');

    // 2. Modify p256dh to be nullable
    await pool.query('ALTER TABLE push_subscriptions MODIFY COLUMN p256dh TEXT NULL');
    console.log('[Migration] Column p256dh modified to NULL successfully.');

    // 3. Modify auth to be nullable
    await pool.query('ALTER TABLE push_subscriptions MODIFY COLUMN auth TEXT NULL');
    console.log('[Migration] Column auth modified to NULL successfully.');

    // 4. Try adding fcm_token column (idempotent)
    try {
      await pool.query('ALTER TABLE push_subscriptions ADD COLUMN fcm_token VARCHAR(255) NULL UNIQUE');
      console.log('[Migration] Column fcm_token added successfully.');
    } catch (colErr) {
      if (colErr.code === 'ER_DUP_COLUMN_NAME') {
        console.log('[Migration] Column fcm_token already exists.');
      } else {
        throw colErr;
      }
    }

    // 5. Try adding platform column (idempotent)
    try {
      await pool.query('ALTER TABLE push_subscriptions ADD COLUMN platform VARCHAR(50) DEFAULT "web"');
      console.log('[Migration] Column platform added successfully.');
    } catch (colErr) {
      if (colErr.code === 'ER_DUP_COLUMN_NAME') {
        console.log('[Migration] Column platform already exists.');
      } else {
        throw colErr;
      }
    }

    console.log('[Migration] Migration completed successfully! ✅');
  } catch (err) {
    console.error('[Migration] Migration failed:', err);
  } finally {
    await pool.end();
  }
}

migrate();

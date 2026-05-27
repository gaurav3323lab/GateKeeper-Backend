/**
 * saveNotif.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Utility to persist in-app notifications to the `in_app_notifications` table.
 * This is what powers the Notifications Bell/Tab in the resident and guard UI.
 *
 * Usage:
 *   const { saveNotifForFlat, saveNotifForUser, saveNotifForRole } = require('../utils/saveNotif');
 *
 *   // Notify a specific flat (e.g. visitor arrived)
 *   await saveNotifForFlat(societyId, tower, flat_number, 'visitor', '🚪 Visitor Aaya!', 'Ramesh Gate par hai');
 *
 *   // Notify a specific user (e.g. their vehicle entry)
 *   await saveNotifForUser(userId, societyId, 'vehicle', '🚗 Gaadi Aayi', 'DL3CAB1234 enter kiya');
 *
 *   // Notify all guards and managers (e.g. SOS)
 *   await saveNotifForRole(societyId, ['guard','manager'], 'sos', '🚨 SOS', 'Flat A-101 se SOS!');
 */

const db = require('../config/db');

/**
 * Save a notification targeted at a specific flat (tower + flat_number).
 * All residents in that flat will see it.
 */
async function saveNotifForFlat(societyId, tower, flat_number, type, title, message) {
  try {
    if (!flat_number) return;
    await db.execute(
      `INSERT INTO in_app_notifications (society_id, tower, flat_number, type, title, message)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [societyId || null, tower || null, flat_number, type || 'general', title, message]
    );
  } catch (err) {
    console.error('[SaveNotif] saveNotifForFlat error:', err.message);
  }
}

/**
 * Save a notification targeted at a specific user by their user_id.
 */
async function saveNotifForUser(userId, societyId, type, title, message) {
  try {
    if (!userId) return;
    await db.execute(
      `INSERT INTO in_app_notifications (user_id, society_id, type, title, message)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, societyId || null, type || 'general', title, message]
    );
  } catch (err) {
    console.error('[SaveNotif] saveNotifForUser error:', err.message);
  }
}

/**
 * Save a society-wide notification (tower IS NULL, flat_number IS NULL, user_id IS NULL).
 * All users in the society will see it.
 */
async function saveNotifForSociety(societyId, type, title, message) {
  try {
    if (!societyId) return;
    await db.execute(
      `INSERT INTO in_app_notifications (society_id, type, title, message)
       VALUES (?, ?, ?, ?)`,
      [societyId, type || 'general', title, message]
    );
  } catch (err) {
    console.error('[SaveNotif] saveNotifForSociety error:', err.message);
  }
}

/**
 * Save notifications for all users with a given role in a society.
 * Roles: 'guard', 'manager', 'resident_primary', etc.
 * Each matching user gets a personal user_id-based notification row.
 */
async function saveNotifForRole(societyId, roles, type, title, message) {
  try {
    if (!societyId || !roles || roles.length === 0) return;
    const placeholders = roles.map(() => '?').join(', ');
    const [users] = await db.execute(
      `SELECT id FROM users WHERE society_id = ? AND role IN (${placeholders}) AND account_status = 'active'`,
      [societyId, ...roles]
    );
    for (const user of users) {
      await saveNotifForUser(user.id, societyId, type, title, message);
    }
  } catch (err) {
    console.error('[SaveNotif] saveNotifForRole error:', err.message);
  }
}

module.exports = { saveNotifForFlat, saveNotifForUser, saveNotifForSociety, saveNotifForRole };

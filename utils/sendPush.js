const webpush = require('web-push');
const db = require('../config/db');

// ── VAPID Safe Init ───────────────────────────────────────────
// Agar Hostinger par VAPID keys set nahi hain, server crash na ho
// Push silently disabled ho jayega — baaki sab normal chalega
let pushEnabled = false;
try {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL || 'mailto:admin@gatekeeper.app';
  if (pub && priv) {
    webpush.setVapidDetails(email, pub, priv);
    pushEnabled = true;
    console.log('[Push] VAPID initialized successfully ✅');
  } else {
    console.warn('[Push] VAPID keys missing — push notifications disabled. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env');
  }
} catch (err) {
  console.error('[Push] VAPID init failed — push notifications disabled:', err.message);
}

/**
 * Send push notification to a specific user by their user_id
 * @param {number} userId
 * @param {string} title
 * @param {string} body
 * @param {object} data  — extra data sent to SW (e.g. url to open)
 */
async function sendPushToUser(userId, title, body, data = {}) {
  if (!pushEnabled) return;
  try {
    const [subs] = await db.execute(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
      [userId]
    );
    if (!subs.length) return;

    const payload = JSON.stringify({ title, body, data });

    await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        ).catch(async err => {
          // If subscription expired (410) or invalid (404), delete it
          if (err.statusCode === 410 || err.statusCode === 404) {
            await db.execute(
              'DELETE FROM push_subscriptions WHERE endpoint = ?',
              [sub.endpoint]
            );
          }
        })
      )
    );
  } catch (err) {
    console.error('[Push] sendPushToUser error:', err.message);
  }
}

/**
 * Send push notification to ALL users with a specific role
 * @param {string} role  — e.g. 'manager', 'guard'
 * @param {string} title
 * @param {string} body
 * @param {object} data
 */
async function sendPushToRole(role, title, body, data = {}) {
  if (!pushEnabled) return;
  try {
    const [subs] = await db.execute(
      `SELECT ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps
       JOIN users u ON ps.user_id = u.id
       WHERE u.role = ?`,
      [role]
    );
    if (!subs.length) return;

    const payload = JSON.stringify({ title, body, data });

    await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        ).catch(async err => {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await db.execute(
              'DELETE FROM push_subscriptions WHERE endpoint = ?',
              [sub.endpoint]
            );
          }
        })
      )
    );
  } catch (err) {
    console.error('[Push] sendPushToRole error:', err.message);
  }
}

/**
 * Send push notification to ALL users in a society
 * @param {number} societyId
 * @param {string} title
 * @param {string} body
 * @param {object} data
 */
async function sendPushToSociety(societyId, title, body, data = {}) {
  if (!pushEnabled) return;
  try {
    const [subs] = await db.execute(
      `SELECT ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps
       JOIN users u ON ps.user_id = u.id
       WHERE u.society_id = ?`,
      [societyId]
    );
    if (!subs.length) return;

    const payload = JSON.stringify({ title, body, data });

    await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        ).catch(async err => {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await db.execute(
              'DELETE FROM push_subscriptions WHERE endpoint = ?',
              [sub.endpoint]
            );
          }
        })
      )
    );
  } catch (err) {
    console.error('[Push] sendPushToSociety error:', err.message);
  }
}

/**
 * Send push notification to a specific flat (resident_primary + resident_family)
 * @param {string} flatNumber
 * @param {string} title
 * @param {string} body
 * @param {object} data
 */
async function sendPushToFlat(flatNumber, title, body, data = {}) {
  if (!pushEnabled) return;
  try {
    const [subs] = await db.execute(
      `SELECT ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps
       JOIN users u ON ps.user_id = u.id
       WHERE u.flat_number = ? AND u.role IN ('resident_primary', 'resident_family')`,
      [flatNumber]
    );
    if (!subs.length) return;

    const payload = JSON.stringify({ title, body, data });

    await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        ).catch(async err => {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await db.execute(
              'DELETE FROM push_subscriptions WHERE endpoint = ?',
              [sub.endpoint]
            );
          }
        })
      )
    );
  } catch (err) {
    console.error('[Push] sendPushToFlat error:', err.message);
  }
}

module.exports = { sendPushToUser, sendPushToRole, sendPushToSociety, sendPushToFlat };

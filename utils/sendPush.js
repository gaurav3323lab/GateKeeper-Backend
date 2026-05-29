const webpush = require('web-push');
const db = require('../config/db');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// ── Socket.io reference (injected by server.js after startup) ───
let _io = null;
function setIO(io) { _io = io; }
function emitNotif(room, data) {
  try { if (_io && room) _io.to(room).emit('new_notification', data); } catch(e) {}
}

// ── Firebase Admin SDK Safe Init (Modern FCM HTTP v1) ──────────
let firebaseApp = null;
const serviceAccountPath = path.join(__dirname, '../firebase-service-account.json');

if (fs.existsSync(serviceAccountPath)) {
  try {
    const serviceAccount = require(serviceAccountPath);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('[Push] Firebase Admin SDK initialized successfully with HTTP v1 API ✅');
  } catch (err) {
    console.error('[Push] Failed to initialize Firebase Admin SDK:', err.message);
  }
} else {
  console.warn('[Push] firebase-service-account.json not found at root. Modern FCM HTTP v1 notifications will not be sent.');
}

// ── VAPID Safe Init ───────────────────────────────────────────
let pushEnabled = false;
try {
  const pub = process.env.VAPID_PUBLIC_KEY || 'BMK5njcYYX9a_oCtRrwogHtGMHkLc0ZpwJEv-rFMVh7agKIoWD3IXStaW_Ui77-gYz-hs_fHwTx94HsEOXFbPTg';
  const priv = process.env.VAPID_PRIVATE_KEY || 'FwyTQ5pMaNWFcAWUcGx6v0u1B1Hd3m07NYMj1zEd76E';
  const email = process.env.VAPID_EMAIL || 'mailto:admin@gatekeeper.app';
  
  webpush.setVapidDetails(email, pub, priv);
  pushEnabled = true;
  console.log('[Push] VAPID initialized successfully ✅ (using keys)');
} catch (err) {
  console.error('[Push] VAPID init failed — push notifications disabled:', err.message);
}

/**
 * Unified Push Sender — Handles Web Push and Native Mobile FCM
 * @param {object} sub  — subscription object from database
 * @param {string} title
 * @param {string} body
 * @param {object} data
 */
async function sendSinglePush(sub, title, body, data = {}) {
  // 1. Native Mobile FCM Push (via Modern Firebase Admin HTTP v1, fallback to legacy key)
  if (sub.fcm_token) {
    if (firebaseApp) {
      try {
        const isVisitorCall = data.type === 'visitor';
        
        const message = {
          token: sub.fcm_token,
          android: {
            priority: 'high', // High priority delivery
          }
        };

        if (isVisitorCall) {
          message.android.ttl = 60 * 1000; // 1 min time to live for visitor calls
          
          // Pure data payload for MyMessagingService background processing
          message.data = {
            ...data,
            title,
            body,
            guest_id: data.guest_id ? String(data.guest_id) : undefined,
            is_visitor_call: 'true',
            visitor_name: data.visitor_name || 'Walk-in Visitor',
            flat_number: data.flat_number || '',
            purpose: data.purpose || 'Walk-in'
          };
        } else {
          // Normal notification + data for background/foreground Capacitor listener
          message.notification = {
            title,
            body
          };
          message.data = {
            ...data,
            title,
            body
          };
        }

        const response = await admin.messaging().send(message);
        console.log(`[Push] Mobile FCM v1 notification sent successfully to sub ID: ${sub.id}`);
      } catch (fcmErr) {
        console.error(`[Push] Mobile FCM v1 dispatch failed for sub ID: ${sub.id}:`, fcmErr.message);
      }
    } else {
      // Legacy Fallback (Returns 404 on modern accounts but preserved as safe fallback)
      try {
        const fcmServerKey = process.env.FCM_SERVER_KEY || 'AAAA3x96DJs:APA91bF84f_gQ5R_J4D7K1-v_OUp31q-p_Dk6c';
        const isVisitorCall = data.type === 'visitor';
        const payload = {
          to: sub.fcm_token,
          priority: 'high',
          collapse_key: isVisitorCall ? 'visitor_call' : undefined,
        };

        if (isVisitorCall) {
          payload.data = {
            ...data,
            title,
            body,
            guest_id: data.guest_id ? String(data.guest_id) : undefined,
            is_visitor_call: 'true',
            visitor_name: data.visitor_name || 'Walk-in Visitor',
            flat_number: data.flat_number || '',
            purpose: data.purpose || 'Walk-in'
          };
        } else {
          payload.notification = {
            title,
            body,
            sound: 'default',
            click_action: 'FCM_PLUGIN_ACTIVITY',
            android_channel_id: 'default',
            notification_priority: 'PRIORITY_HIGH',
            visibility: 'PRIVATE',
          };
          payload.data = {
            ...data,
            title,
            body,
          };
        }

        const response = await fetch('https://fcm.googleapis.com/fcm/send', {
          method: 'POST',
          headers: {
            'Authorization': `key=${fcmServerKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          console.log(`[Push] Mobile FCM notification sent successfully to sub ID: ${sub.id}`);
        } else {
          const errText = await response.text();
          console.error(`[Push] Mobile FCM notification failed for sub ID: ${sub.id}:`, errText);
        }
      } catch (fcmErr) {
        console.error(`[Push] Mobile FCM dispatch exception:`, fcmErr.message);
      }
    }
    return;
  }

  // 2. Standard Web Push Notification (Free browser vendor endpoints)
  if (sub.endpoint && sub.p256dh && sub.auth) {
    try {
      const payload = JSON.stringify({ title, body, data });
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      console.log(`[Push] Web push notification sent successfully to sub ID: ${sub.id}`);
    } catch (err) {
      // If subscription has expired (410) or invalid (404), auto-delete it from DB to maintain hygiene
      if (err.statusCode === 410 || err.statusCode === 404) {
        await db.execute('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]);
        console.log(`[Push] Pruned expired Web subscription: ${sub.endpoint.slice(0, 40)}...`);
      } else {
        console.error(`[Push] Web push failed for sub ID: ${sub.id}:`, err.message);
      }
    }
  }
}

/**
 * Send push notification to a specific user by their user_id
 */
async function sendPushToUser(userId, title, body, data = {}) {
  const type = data.type || 'general';
  try {
    // Fetch society_id for this user to store correctly
    const [uInfo] = await db.execute('SELECT society_id FROM users WHERE id = ?', [userId]);
    const societyId = uInfo[0]?.society_id || null;
    await db.execute(
      'INSERT INTO in_app_notifications (user_id, society_id, title, message, type) VALUES (?, ?, ?, ?, ?)',
      [userId, societyId, title, body, type]
    );
    // Emit socket event so frontend bell updates in realtime
    emitNotif(`user_${userId}`, { type, title, body });
  } catch(e) { console.error('DB Insert Error:', e.message); }

  if (!pushEnabled) return;
  try {
    const [subs] = await db.execute(
      'SELECT id, endpoint, p256dh, auth, fcm_token, platform FROM push_subscriptions WHERE user_id = ?',
      [userId]
    );
    if (!subs.length) return;

    await Promise.allSettled(subs.map(sub => sendSinglePush(sub, title, body, data)));
  } catch (err) {
    console.error('[Push] sendPushToUser error:', err.message);
  }
}

/**
 * Send push notification to ALL users with a specific role
 */
async function sendPushToRole(role, title, body, data = {}) {
  const type = data.type || 'general';
  try {
    await db.execute(
      'INSERT INTO in_app_notifications (user_id, title, message, type) SELECT id, ?, ?, ? FROM users WHERE role = ?',
      [title, body, type, role]
    );
    // Emit new_notification to the role room
    emitNotif(`${role}_room`, { type, title, body });
  } catch(e) { console.error('DB Insert Error:', e.message); }

  if (!pushEnabled) return;
  try {
    const [subs] = await db.execute(
      `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth, ps.fcm_token, ps.platform
       FROM push_subscriptions ps
       JOIN users u ON ps.user_id = u.id
       WHERE u.role = ?`,
      [role]
    );
    if (!subs.length) return;

    await Promise.allSettled(subs.map(sub => sendSinglePush(sub, title, body, data)));
  } catch (err) {
    console.error('[Push] sendPushToRole error:', err.message);
  }
}

/**
 * Send push notification to ALL users in a society
 */
async function sendPushToSociety(societyId, title, body, data = {}) {
  const type = data.type || 'general';
  try {
    await db.execute(
      'INSERT INTO in_app_notifications (society_id, title, message, type) VALUES (?, ?, ?, ?)',
      [societyId, title, body, type]
    );
    // Emit to society room (all connected users in this society)
    emitNotif(`society_${societyId}`, { type, title, body });
  } catch(e) { console.error('DB Insert Error:', e.message); }

  if (!pushEnabled) return;
  try {
    const [subs] = await db.execute(
      `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth, ps.fcm_token, ps.platform
       FROM push_subscriptions ps
       JOIN users u ON ps.user_id = u.id
       WHERE u.society_id = ?`,
      [societyId]
    );
    if (!subs.length) return;

    await Promise.allSettled(subs.map(sub => sendSinglePush(sub, title, body, data)));
  } catch (err) {
    console.error('[Push] sendPushToSociety error:', err.message);
  }
}

/**
 * Send push notification to a specific flat (resident_primary + resident_family)
 */
async function sendPushToFlat(tower, flatNumber, title, body, data = {}) {
  const type = data.type || 'general';
  const societyId = data.society_id || null;
  try {
    await db.execute(
      'INSERT INTO in_app_notifications (society_id, tower, flat_number, title, message, type) VALUES (?, ?, ?, ?, ?, ?)',
      [societyId, tower || '', flatNumber, title, body, type]
    );
    // Emit to the flat's socket room so bell updates in realtime
    const flatRoom = `society_${societyId}_flat_${tower ? tower + '-' : ''}${flatNumber}`;
    emitNotif(flatRoom, { type, title, body });
  } catch(e) { console.error('DB Insert Error:', e.message); }

  if (!pushEnabled) return;
  try {
    let query = `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth, ps.fcm_token, ps.platform
                 FROM push_subscriptions ps
                 JOIN users u ON ps.user_id = u.id
                 WHERE COALESCE(u.tower, '') = CAST(? AS CHAR) AND u.flat_number = ? AND u.role IN ('resident_primary', 'resident_family')`;
    let params = [tower || null, flatNumber];
    if (societyId) {
      query += ` AND u.society_id = ?`;
      params.push(societyId);
    }
    const [subs] = await db.execute(query, params);
    if (!subs.length) return;

    await Promise.allSettled(subs.map(sub => sendSinglePush(sub, title, body, data)));
  } catch (err) {
    console.error('[Push] sendPushToFlat error:', err.message);
  }
}

module.exports = { sendPushToUser, sendPushToRole, sendPushToSociety, sendPushToFlat, setIO };

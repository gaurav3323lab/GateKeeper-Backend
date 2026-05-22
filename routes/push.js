const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken } = require('../middlewares/auth');

// GET /api/push/vapid-key — Frontend ko public VAPID key deta hai (no auth needed)
router.get('/vapid-key', (req, res) => {
  // Bulletproof fallback so it works instantly on Hostinger even without manual env vars configuration
  const key = process.env.VAPID_PUBLIC_KEY || 'BMK5njcYYX9a_oCtRrwogHtGMHkLc0ZpwJEv-rFMVh7agKIoWD3IXStaW_Ui77-gYz-hs_fHwTx94HsEOXFbPTg';
  res.json({ publicKey: key });
});

// POST /api/push/subscribe — User ki push subscription save karo (Web + Mobile)
router.post('/subscribe', verifyToken, async (req, res) => {
  const { endpoint, keys, fcm_token, platform } = req.body;

  // 1. Mobile FCM Token Registration
  if (fcm_token) {
    try {
      await db.execute(
        `INSERT INTO push_subscriptions (user_id, fcm_token, platform)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), platform = VALUES(platform)`,
        [req.user.id, fcm_token, platform || 'android']
      );
      console.log(`[Push] Mobile Subscribed: user_id=${req.user.id}, platform=${platform || 'android'}`);
      return res.status(201).json({ message: 'Mobile push registered successfully' });
    } catch (err) {
      console.error('[Push] Mobile register error:', err.message);
      return res.status(500).json({ message: 'Server Error', error: err.message });
    }
  }

  // 2. Standard Web Push Registration
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ message: 'Invalid subscription object — fcm_token or Web subscription required' });
  }

  try {
    // Upsert: agar endpoint already hai to update karo, nahi to insert
    await db.execute(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, platform)
       VALUES (?, ?, ?, ?, 'web')
       ON DUPLICATE KEY UPDATE p256dh = VALUES(p256dh), auth = VALUES(auth), user_id = VALUES(user_id)`,
      [req.user.id, endpoint, keys.p256dh, keys.auth]
    );
    console.log(`[Push] Web Subscribed: user_id=${req.user.id}`);
    res.status(201).json({ message: 'Web push subscribed successfully' });
  } catch (err) {
    console.error('[Push] Web subscribe error:', err.message);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// DELETE /api/push/unsubscribe — Subscription delete karo
router.delete('/unsubscribe', verifyToken, async (req, res) => {
  const { endpoint } = req.body;
  try {
    if (endpoint) {
      await db.execute(
        'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
        [req.user.id, endpoint]
      );
    } else {
      // Delete all subscriptions for this user
      await db.execute(
        'DELETE FROM push_subscriptions WHERE user_id = ?',
        [req.user.id]
      );
    }
    res.json({ message: 'Unsubscribed successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

module.exports = router;

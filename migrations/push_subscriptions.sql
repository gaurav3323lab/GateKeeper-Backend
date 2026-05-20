-- ============================================================
-- GateKeeper — Push Subscriptions Table
-- Ek baar run karo (Hostinger phpMyAdmin ya MySQL terminal mein)
-- ============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          INT          AUTO_INCREMENT PRIMARY KEY,
  user_id     INT          NOT NULL,
  endpoint    TEXT         NOT NULL,
  p256dh      TEXT         NOT NULL,
  auth        TEXT         NOT NULL,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_endpoint (endpoint(500)),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

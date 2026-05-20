-- ============================================================
-- Migration: Emergency Contacts Table
-- Run this in phpMyAdmin or MySQL CLI
-- ============================================================

CREATE TABLE IF NOT EXISTS emergency_contacts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  society_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  category ENUM('Police','Fire Brigade','Ambulance','Electrician','Plumber','Security','Committee','Other') NOT NULL DEFAULT 'Other',
  priority INT NOT NULL DEFAULT 5 COMMENT '1=highest priority, 10=lowest',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE,
  INDEX idx_society_priority (society_id, priority)
);

-- ============================================================
-- Update users table: Add 'admin' to role ENUM if using ENUM
-- Run this only if your users.role column is ENUM type
-- ============================================================

-- Check your column type first:
-- SHOW COLUMNS FROM users LIKE 'role';

-- If ENUM, run this:
-- ALTER TABLE users MODIFY COLUMN role ENUM(
--   'super_admin','admin','manager','guard','technician',
--   'resident_primary','resident_family','staff'
-- ) NOT NULL DEFAULT 'resident_primary';

-- ============================================================
-- Sample: Create an Admin user for a society
-- Password: Admin@123
-- ============================================================

-- INSERT INTO users (name, phone, password_hash, role, account_status, society_id)
-- VALUES ('Society Admin', '7000000001', '$2b$10$bGda5zbyMbJn3HoLuFCef.uGBZvJ6gDugoMdmiouL5ALvQmtoqIIe', 'admin', 'active', 1);
-- (Note: above hash = '123456')

-- ============================================================
-- Sample: Emergency contacts for Green Valley (society_id=1)
-- ============================================================

INSERT IGNORE INTO emergency_contacts (society_id, name, phone, category, priority) VALUES
(1, 'Local Police Station', '100', 'Police', 1),
(1, 'Fire Brigade', '101', 'Fire Brigade', 1),
(1, 'Ambulance', '102', 'Ambulance', 1),
(1, 'Society Security Office', '9000000001', 'Security', 2),
(1, 'Raju Plumber', '9000000002', 'Plumber', 3),
(1, 'Amit Electrician', '9000000003', 'Electrician', 3),
(1, 'Society Committee Head', '9000000004', 'Committee', 4);

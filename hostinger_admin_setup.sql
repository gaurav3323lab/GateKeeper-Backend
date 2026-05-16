-- Import this file into your Hostinger phpMyAdmin (resident_management database)
-- It will insert the highly secure Admin and Manager accounts.
-- Note: Make sure your `users` table is empty or doesn't already have these phone numbers.

SET FOREIGN_KEY_CHECKS = 0;

INSERT INTO users (name, phone, password_hash, role, account_status, flat_number) 
VALUES 
('Super Admin', '9999999999', '$2b$10$uRV4J0Er/rU4TJVSzRrWLOHmukMPN1WjF6eV1ERM2814jDNRgYMIO', 'super_admin', 'active', NULL),
('Society Manager', '8888888888', '$2b$10$y7XeHuzoKGGHaJ5Q0/ajZuo/4gFLLPGmIU4AYFf.9a5Otg7kvMbY.', 'manager', 'active', NULL);

SET FOREIGN_KEY_CHECKS = 1;

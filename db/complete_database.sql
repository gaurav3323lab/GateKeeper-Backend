-- Resident Management & Security System - COMPLETE DATABASE SETUP
-- Includes Schema and Dummy Data for Testing

-- 1. SETUP TABLES
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(15) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('super_admin', 'manager', 'guard', 'technician', 'resident_primary', 'resident_family') NOT NULL,
    account_status ENUM('pending', 'active', 'rejected') DEFAULT 'pending',
    society_id INT DEFAULT 1,
    parent_id INT DEFAULT NULL,
    flat_number VARCHAR(20) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vehicles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    vehicle_number VARCHAR(20) UNIQUE NOT NULL,
    type VARCHAR(50) NOT NULL,
    brand VARCHAR(50) DEFAULT 'Other',
    status ENUM('Inside', 'Outside') DEFAULT 'Outside',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS service_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT,
    photo_url VARCHAR(255),
    status ENUM('Open', 'In-progress', 'Resolved') DEFAULT 'Open',
    assigned_technician_id INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_technician_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS emergencies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    status ENUM('Active', 'Resolved') DEFAULT 'Active',
    resolved_by INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS guests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(15) NOT NULL,
    purpose VARCHAR(255),
    host_id INT NOT NULL,
    qr_code VARCHAR(100) UNIQUE NOT NULL,
    valid_from DATETIME NOT NULL,
    valid_to DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2. INSERT DUMMY DATA (Passwords are '1234' for all)
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE users;
TRUNCATE TABLE vehicles;
TRUNCATE TABLE service_requests;
SET FOREIGN_KEY_CHECKS = 1;

INSERT INTO users (name, phone, password_hash, role, account_status, flat_number) VALUES 
('Super Admin', '9999999999', '1234', 'super_admin', 'active', NULL),
('Manager Sahab', '8888888888', '1234', 'manager', 'active', NULL),
('Security Guard 1', '7777777777', '1234', 'guard', 'active', NULL),
('Suresh Plumber', '6666666666', '1234', 'technician', 'active', NULL),
('Rahul Resident', '9876543210', '1234', 'resident_primary', 'active', 'A-402');

INSERT INTO vehicles (user_id, vehicle_number, type, brand, status) VALUES 
(5, 'MH 12 AB 1234', 'Car / SUV (4-Wheeler)', 'Hyundai', 'Inside');

INSERT INTO service_requests (user_id, category, description, status) VALUES 
(5, 'Plumber', 'Kitchen tap is leaking', 'Open');

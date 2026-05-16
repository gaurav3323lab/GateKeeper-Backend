-- Resident Management & Security System - FINAL DATABASE SETUP FOR HOSTINGER
-- Includes Complete Schema and Dummy Data with Secure Bcrypt Passwords

CREATE DATABASE IF NOT EXISTS resident_management;
USE resident_management;

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

CREATE TABLE IF NOT EXISTS deliveries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company VARCHAR(50) NOT NULL,
    delivery_person_name VARCHAR(100),
    phone VARCHAR(15),
    resident_id INT NOT NULL,
    status ENUM('pending', 'approved', 'rejected', 'arrived') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (resident_id) REFERENCES users(id) ON DELETE CASCADE
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

CREATE TABLE IF NOT EXISTS staff (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(15) UNIQUE NOT NULL,
    role VARCHAR(50) NOT NULL,
    qr_code VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS staff_attendance (
    id INT AUTO_INCREMENT PRIMARY KEY,
    staff_id INT NOT NULL,
    check_in_time DATETIME NOT NULL,
    check_out_time DATETIME DEFAULT NULL,
    date DATE NOT NULL,
    FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS entry_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    entity_type ENUM('vehicle', 'guest', 'delivery', 'staff') NOT NULL,
    entity_id INT NOT NULL,
    entry_time DATETIME NOT NULL,
    exit_time DATETIME DEFAULT NULL,
    gate_number VARCHAR(10) NOT NULL,
    guard_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (guard_id) REFERENCES users(id)
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

-- 2. INSERT SECURE DUMMY DATA
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE users;
TRUNCATE TABLE vehicles;
TRUNCATE TABLE service_requests;
SET FOREIGN_KEY_CHECKS = 1;

-- Note: Admin/Manager have strong passwords. Others use '1234' (which is now bcrypt hashed)
INSERT INTO users (name, phone, password_hash, role, account_status, flat_number) VALUES 
('Super Admin', '9999999999', '$2b$10$uRV4J0Er/rU4TJVSzRrWLOHmukMPN1WjF6eV1ERM2814jDNRgYMIO', 'super_admin', 'active', NULL),
('Society Manager', '8888888888', '$2b$10$y7XeHuzoKGGHaJ5Q0/ajZuo/4gFLLPGmIU4AYFf.9a5Otg7kvMbY.', 'manager', 'active', NULL),
('Security Guard 1', '7777777777', '$2b$10$ntL1fAUZPoXkOzZ6wJDEC.hg6zbiDZXy/cOnDnlji0t/M9uBPlGJO', 'guard', 'active', NULL),
('Suresh Plumber', '6666666666', '$2b$10$ntL1fAUZPoXkOzZ6wJDEC.hg6zbiDZXy/cOnDnlji0t/M9uBPlGJO', 'technician', 'active', NULL),
('Rahul Resident', '9876543210', '$2b$10$ntL1fAUZPoXkOzZ6wJDEC.hg6zbiDZXy/cOnDnlji0t/M9uBPlGJO', 'resident_primary', 'active', 'A-402');

INSERT INTO vehicles (user_id, vehicle_number, type, brand, status) VALUES 
(5, 'MH 12 AB 1234', 'Car / SUV (4-Wheeler)', 'Hyundai', 'Inside');

INSERT INTO service_requests (user_id, category, description, status) VALUES 
(5, 'Plumber', 'Kitchen tap is leaking', 'Open');

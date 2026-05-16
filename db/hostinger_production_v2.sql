-- GateKeeper Resident Management & Security System
-- Production Ready SQL Setup (V2)
-- Combined Schema + Initial Admin Data

SET FOREIGN_KEY_CHECKS = 0;

-- 1. SETUP TABLES
CREATE TABLE IF NOT EXISTS societies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    society_code VARCHAR(10) UNIQUE NOT NULL,
    address TEXT NOT NULL,
    city VARCHAR(50) NOT NULL,
    state VARCHAR(50) NOT NULL,
    zip_code VARCHAR(10) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(15) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('super_admin', 'manager', 'guard', 'technician', 'resident_primary', 'resident_family') NOT NULL,
    account_status ENUM('pending', 'active', 'rejected') DEFAULT 'pending',
    society_id INT DEFAULT NULL,
    parent_id INT DEFAULT NULL,
    flat_number VARCHAR(20) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE SET NULL,
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

CREATE TABLE IF NOT EXISTS announcements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    category ENUM('General', 'Maintenance', 'Emergency', 'Event', 'Notice') DEFAULT 'General',
    author_id INT NOT NULL,
    is_pinned TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. INITIAL DATA (Super Admin & Default Society)
INSERT INTO societies (id, name, society_code, address, city, state, zip_code) 
VALUES (1, 'Gaurav Heights', 'GH001', 'Sector 23', 'Mumbai', 'Maharashtra', '400001')
ON DUPLICATE KEY UPDATE name=name;

-- Super Admin (9999999999 / 1234)
INSERT INTO users (name, phone, password_hash, role, account_status, society_id) 
VALUES ('Super Admin', '9999999999', '$2b$10$/k3MtD.LGgdDYH0vpSqvHurkJs37kQ3zLpTH4LJ92jKfyXxGXcZbq', 'super_admin', 'active', 1)
ON DUPLICATE KEY UPDATE name=name;

-- Manager (8888888888 / 1234)
INSERT INTO users (name, phone, password_hash, role, account_status, society_id) 
VALUES ('Main Manager', '8888888888', '$2b$10$/k3MtD.LGgdDYH0vpSqvHurkJs37kQ3zLpTH4LJ92jKfyXxGXcZbq', 'manager', 'active', 1)
ON DUPLICATE KEY UPDATE name=name;

-- Guard (7777777777 / 1234)
INSERT INTO users (name, phone, password_hash, role, account_status, society_id) 
VALUES ('Main Guard', '7777777777', '$2b$10$/k3MtD.LGgdDYH0vpSqvHurkJs37kQ3zLpTH4LJ92jKfyXxGXcZbq', 'guard', 'active', 1)
ON DUPLICATE KEY UPDATE name=name;

SET FOREIGN_KEY_CHECKS = 1;

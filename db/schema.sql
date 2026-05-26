-- Resident Management & Security System Schema

CREATE DATABASE IF NOT EXISTS resident_management;
USE resident_management;

-- Societies / Apartments Table
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

-- Users table handles Super Admin, Manager, Guard, Technician, Resident (Primary & Family)
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(15) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('super_admin', 'manager', 'guard', 'technician', 'resident_primary', 'resident_family') NOT NULL,
    is_online BOOLEAN DEFAULT FALSE,
    account_status ENUM('pending', 'active', 'rejected') DEFAULT 'pending',
    society_id INT DEFAULT NULL,
    tower VARCHAR(50) DEFAULT NULL,
    parent_id INT DEFAULT NULL, -- For family members linking to primary resident
    flat_number VARCHAR(20) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Vehicles (Resident Garage)
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

-- Pre-approved or walk-in guests with unique QR passes
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

-- Pre-approved deliveries (Swiggy/Zomato/Amazon)
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

-- Service requests/ticketing (Plumber, Electrician)
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

-- Daily help management (Maid, Cook, etc.)
CREATE TABLE IF NOT EXISTS staff (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(15) UNIQUE NOT NULL,
    role VARCHAR(50) NOT NULL,
    qr_code VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Staff attendance tracking
CREATE TABLE IF NOT EXISTS staff_attendance (
    id INT AUTO_INCREMENT PRIMARY KEY,
    staff_id INT NOT NULL,
    check_in_time DATETIME NOT NULL,
    check_out_time DATETIME DEFAULT NULL,
    date DATE NOT NULL,
    FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
);

-- Unified logs for entry/exit (will be cleared by 90-day retention cron job)
CREATE TABLE IF NOT EXISTS entry_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    entity_type ENUM('vehicle', 'guest', 'delivery', 'staff') NOT NULL,
    entity_id INT NOT NULL, -- Generic ID pointing to respective tables
    entry_time DATETIME NOT NULL,
    exit_time DATETIME DEFAULT NULL,
    gate_number VARCHAR(10) NOT NULL,
    guard_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (guard_id) REFERENCES users(id)
);

-- Emergency SOS Module
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

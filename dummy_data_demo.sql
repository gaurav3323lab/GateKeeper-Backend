SET FOREIGN_KEY_CHECKS = 0;

-- ==========================================
-- DUMMY DATA FOR RESIDENT MANAGEMENT SYSTEM
-- Password for all users below is: 123456
-- ==========================================

-- 0. Insert Societies
INSERT INTO societies (id, name, society_code, address, city, state, zip_code) VALUES
(1, 'Green Valley Apartments', 'GVA123', '123 MG Road', 'Mumbai', 'Maharashtra', '400001'),
(2, 'Sunrise Heights', 'SUN456', '456 FC Road', 'Pune', 'Maharashtra', '411004'),
(3, 'Royal Enclave', 'ROY789', '789 Ring Road', 'Delhi', 'Delhi', '110001');

-- 1. Insert Users
INSERT INTO users (id, name, phone, password_hash, role, account_status, flat_number, society_id) VALUES
(101, 'Ramesh Kumar (Guard)', '7777777701', '$2b$10$bGda5zbyMbJn3HoLuFCef.uGBZvJ6gDugoMdmiouL5ALvQmtoqIIe', 'guard', 'active', NULL, 1),
(102, 'Suresh Singh (Guard)', '7777777702', '$2b$10$bGda5zbyMbJn3HoLuFCef.uGBZvJ6gDugoMdmiouL5ALvQmtoqIIe', 'guard', 'active', NULL, 1),
(103, 'Raju Plumber', '6666666601', '$2b$10$bGda5zbyMbJn3HoLuFCef.uGBZvJ6gDugoMdmiouL5ALvQmtoqIIe', 'technician', 'active', NULL, 1),
(104, 'Amit Electrician', '6666666602', '$2b$10$bGda5zbyMbJn3HoLuFCef.uGBZvJ6gDugoMdmiouL5ALvQmtoqIIe', 'technician', 'active', NULL, 1),
(105, 'Aditi Sharma', '9876543201', '$2b$10$bGda5zbyMbJn3HoLuFCef.uGBZvJ6gDugoMdmiouL5ALvQmtoqIIe', 'resident_primary', 'active', 'A-101', 1),
(106, 'Rahul Sharma', '9876543202', '$2b$10$bGda5zbyMbJn3HoLuFCef.uGBZvJ6gDugoMdmiouL5ALvQmtoqIIe', 'resident_family', 'active', 'A-101', 1),
(107, 'Vikram Singh', '9876543203', '$2b$10$bGda5zbyMbJn3HoLuFCef.uGBZvJ6gDugoMdmiouL5ALvQmtoqIIe', 'resident_primary', 'active', 'B-205', 1),
(108, 'Neha Singh', '9876543204', '$2b$10$bGda5zbyMbJn3HoLuFCef.uGBZvJ6gDugoMdmiouL5ALvQmtoqIIe', 'resident_family', 'active', 'B-205', 1),
(109, 'Karan Patel', '9876543205', '$2b$10$bGda5zbyMbJn3HoLuFCef.uGBZvJ6gDugoMdmiouL5ALvQmtoqIIe', 'resident_primary', 'active', 'C-304', 1);

-- Set parent_id for family members
UPDATE users SET parent_id = 105 WHERE id = 106;
UPDATE users SET parent_id = 107 WHERE id = 108;

-- 2. Vehicles
INSERT INTO vehicles (id, user_id, vehicle_number, type, brand, status) VALUES
(101, 105, 'MH 12 AB 1010', 'Car / SUV (4-Wheeler)', 'Hyundai Creta', 'Inside'),
(102, 106, 'MH 12 XY 9999', 'Bike / Scooter (2-Wheeler)', 'Honda Activa', 'Outside'),
(103, 107, 'MH 14 CD 2020', 'Car / SUV (4-Wheeler)', 'Tata Nexon', 'Inside'),
(104, 109, 'MH 12 ZZ 5555', 'Bike / Scooter (2-Wheeler)', 'Royal Enfield', 'Inside');

-- 3. Guests
INSERT INTO guests (id, name, phone, purpose, host_id, qr_code, valid_from, valid_to) VALUES
(101, 'Sanjay Gupta', '9123456780', 'Dinner Party', 105, 'QR-GUEST-001', DATE_SUB(NOW(), INTERVAL 1 HOUR), DATE_ADD(NOW(), INTERVAL 5 HOUR)),
(102, 'Pooja Verma', '9123456781', 'Visiting Friend', 107, 'QR-GUEST-002', DATE_ADD(NOW(), INTERVAL 1 DAY), DATE_ADD(NOW(), INTERVAL 25 HOUR)),
(103, 'Rajesh Delivery', '9123456782', 'Furniture Delivery', 109, 'QR-GUEST-003', DATE_SUB(NOW(), INTERVAL 2 HOUR), DATE_SUB(NOW(), INTERVAL 1 HOUR));

-- 4. Deliveries
INSERT INTO deliveries (id, company, delivery_person_name, phone, resident_id, status) VALUES
(101, 'Swiggy', 'Imran Khan', '9988776655', 105, 'arrived'),
(102, 'Amazon', 'Vijay Kumar', '9988776656', 107, 'pending'),
(103, 'Zomato', 'Sandeep', '9988776657', 109, 'approved'),
(104, 'Flipkart', 'Mukesh', '9988776658', 105, 'rejected');

-- 5. Service Requests
INSERT INTO service_requests (id, user_id, category, description, status, assigned_technician_id) VALUES
(101, 105, 'Plumbing', 'Kitchen sink pipe is leaking heavily.', 'Open', NULL),
(102, 107, 'Electrical', 'Living room fan making loud noise.', 'In-progress', 104),
(103, 109, 'Carpentry', 'Main door lock is stuck.', 'Resolved', NULL),
(104, 105, 'Cleaning', 'Deep cleaning needed for balcony.', 'Open', NULL);

-- 6. Staff
INSERT INTO staff (id, name, phone, role, qr_code) VALUES
(101, 'Sunita Devi', '8877665544', 'Maid', 'QR-STAFF-001'),
(102, 'Laxman Rao', '8877665545', 'Driver', 'QR-STAFF-002'),
(103, 'Kamala Bai', '8877665546', 'Cook', 'QR-STAFF-003');

-- 7. Staff Attendance
INSERT INTO staff_attendance (id, staff_id, check_in_time, check_out_time, date) VALUES
(101, 101, CONCAT(CURDATE(), ' 08:00:00'), CONCAT(CURDATE(), ' 12:00:00'), CURDATE()),
(102, 102, CONCAT(CURDATE(), ' 09:30:00'), NULL, CURDATE()),
(103, 103, CONCAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY), ' 07:45:00'), CONCAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY), ' 10:30:00'), DATE_SUB(CURDATE(), INTERVAL 1 DAY));

-- 8. Entry Logs
INSERT INTO entry_logs (id, entity_type, entity_id, entry_time, exit_time, gate_number, guard_id) VALUES
(101, 'vehicle', 101, DATE_SUB(NOW(), INTERVAL 5 HOUR), DATE_SUB(NOW(), INTERVAL 1 HOUR), 'Gate 1', 101),
(102, 'guest', 101, DATE_SUB(NOW(), INTERVAL 30 MINUTE), NULL, 'Gate 1', 102),
(103, 'delivery', 101, DATE_SUB(NOW(), INTERVAL 15 MINUTE), DATE_SUB(NOW(), INTERVAL 5 MINUTE), 'Gate 2', 101),
(104, 'staff', 102, CONCAT(CURDATE(), ' 09:30:00'), NULL, 'Gate 1', 102);

-- 9. Emergencies
INSERT INTO emergencies (id, user_id, status, resolved_by) VALUES
(101, 105, 'Resolved', 101),
(102, 109, 'Active', NULL);

SET FOREIGN_KEY_CHECKS = 1;

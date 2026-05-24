const db = require('../config/db');
const bcrypt = require('bcrypt');

async function main() {
  console.log("🚀 Starting database cleanup...");

  try {
    // 1. Disable foreign key checks to avoid deletion constraint errors
    await db.execute('SET FOREIGN_KEY_CHECKS = 0');
    console.log("✅ Foreign key checks disabled.");

    // 2. Clear transactional logs and inputs
    const tablesToTruncate = [
      'entry_logs',
      'emergencies',
      'guests',
      'deliveries',
      'vehicles',
      'service_requests',
      'announcements',
      'push_subscriptions'
    ];

    for (const table of tablesToTruncate) {
      try {
        await db.execute(`TRUNCATE TABLE ${table}`);
        console.log(`🧹 Cleared table: ${table}`);
      } catch (err) {
        // Fall back to DELETE if TRUNCATE is not allowed
        await db.execute(`DELETE FROM ${table}`);
        console.log(`🧹 Deletions completed on table: ${table}`);
      }
    }

    // 3. Reset Users table to only contain a fresh clean Super Admin
    await db.execute('DELETE FROM users');
    console.log("🧹 Cleared users table.");

    // Ensure Default Society exists in db
    await db.execute(`
      INSERT INTO societies (id, name, society_code, address, city, state, zip_code)
      VALUES (1, 'Gaurav Heights', 'GH001', 'Sector 23', 'Mumbai', 'Maharashtra', '400001')
      ON DUPLICATE KEY UPDATE name = name
    `);
    console.log("🏢 Default society configured.");

    // Insert clean Super Admin
    const passwordHash = await bcrypt.hash('1234', 10);
    await db.execute(`
      INSERT INTO users (id, name, phone, password_hash, role, account_status, society_id)
      VALUES (1, 'Super Admin', '9999999999', ?, 'super_admin', 'active', 1)
    `, [passwordHash]);
    console.log("👑 Fresh Super Admin user created (Phone: 9999999999, Password: 1234).");

    // 4. Re-enable foreign key checks
    await db.execute('SET FOREIGN_KEY_CHECKS = 1');
    console.log("✅ Foreign key checks re-enabled.");
    console.log("✨ Database cleanup complete! System is perfectly fresh and ready for real data.");

  } catch (err) {
    console.error("❌ Cleanup failed:", err);
  } finally {
    process.exit(0);
  }
}

main();

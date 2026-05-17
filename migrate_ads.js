const db = require('./config/db');

async function migrate() {
  try {
    console.log('Creating ads table...');
    await db.execute(`
      CREATE TABLE IF NOT EXISTS ads (
        id INT AUTO_INCREMENT PRIMARY KEY,
        society_id INT,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        image_url VARCHAR(500),
        link VARCHAR(500),
        bg_color VARCHAR(100) DEFAULT 'from-blue-500/20 to-indigo-700/20',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE
      )
    `);
    console.log('Ads table created successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    process.exit();
  }
}

migrate();

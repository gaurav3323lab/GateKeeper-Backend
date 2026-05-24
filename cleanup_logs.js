require('dotenv').config();
const pool = require('./config/db');

async function cleanup() {
  try {
    console.log('[Cleanup] Connecting to database...');
    
    // SQL query to prune duplicate active (exit_time IS NULL) check-ins, keeping only the earliest check-in
    const query = `
      DELETE e1 FROM entry_logs e1
      INNER JOIN entry_logs e2 
      ON e1.entity_type = e2.entity_type 
      AND e1.entity_id = e2.entity_id 
      AND e1.exit_time IS NULL 
      AND e2.exit_time IS NULL
      AND e1.id > e2.id
    `;
    
    const [result] = await pool.execute(query);
    console.log(`[Cleanup] Successfully pruned ${result.affectedRows} duplicate check-in log records! ✅`);
    process.exit(0);
  } catch (err) {
    console.error('[Cleanup] Execution failed:', err);
    process.exit(1);
  }
}

cleanup();

const cron = require('node-cron');
const db = require('../config/db'); // ✅ Fixed: use shared pool, not hardcoded credentials

// Schedule task to run every day at midnight (00:00)
cron.schedule('0 0 * * *', async () => {
  console.log('[Cron Job] Running data cleanup for records older than 90 days...');
  try {
    // 1. Delete old Entry Logs
    const [logResult] = await db.execute(
      `DELETE FROM entry_logs WHERE entry_time < NOW() - INTERVAL 90 DAY`
    );
    console.log(`[Cron Job] Deleted ${logResult.affectedRows} old entry logs.`);

    // 2. Delete old deliveries
    const [deliveryResult] = await db.execute(
      `DELETE FROM deliveries WHERE created_at < NOW() - INTERVAL 90 DAY`
    );
    console.log(`[Cron Job] Deleted ${deliveryResult.affectedRows} old deliveries.`);

    // 3. Delete old resolved service requests
    const [serviceResult] = await db.execute(
      `DELETE FROM service_requests WHERE status = 'Resolved' AND created_at < NOW() - INTERVAL 90 DAY`
    );
    console.log(`[Cron Job] Deleted ${serviceResult.affectedRows} old resolved service requests.`);

    // 4. Delete old resolved emergencies
    const [sosResult] = await db.execute(
      `DELETE FROM emergencies WHERE status = 'Resolved' AND created_at < NOW() - INTERVAL 90 DAY`
    );
    console.log(`[Cron Job] Deleted ${sosResult.affectedRows} old resolved SOS records.`);

    console.log('[Cron Job] Data cleanup completed successfully.');
  } catch (error) {
    console.error('[Cron Job] Error executing data cleanup:', error.message);
  }
});

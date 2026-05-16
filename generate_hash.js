const bcrypt = require('bcrypt');

async function generate() {
  const adminHash = await bcrypt.hash('Admin@GateKeeper2026', 10);
  const managerHash = await bcrypt.hash('Manager@GateKeeper2026', 10);

  console.log('ADMIN_HASH:', adminHash);
  console.log('MANAGER_HASH:', managerHash);
}

generate();

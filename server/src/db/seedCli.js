import { initSchema } from './schema.js';
import { ensureCoreSeed, seedDemoData } from './seed.js';
import { isMySql, closeDb, verifyConnection } from './sqlite.js';

async function main() {
  await verifyConnection();
  await initSchema();
  await ensureCoreSeed();
  await seedDemoData();
  console.log(`EasyPlex (${isMySql() ? 'MySQL' : 'SQLite'}) database initialized and verified successfully.`);
  await closeDb();
}

main().catch(async (err) => {
  console.error('Seed CLI failed:', err);
  await closeDb();
  process.exit(1);
});

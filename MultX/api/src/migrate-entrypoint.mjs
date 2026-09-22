import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSecrets } from './preload.js';

await loadSecrets();
const [{ pool }, { runMigrations }] = await Promise.all([
  import('./db/pool.js'),
  import('./db/migrate.js'),
]);

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  const result = await runMigrations(pool, path.join(here, 'db', 'migrations'));
  console.log(`[Migrate] Applied ${result.applied.length} migrations; ${result.alreadyApplied} already recorded.`);
} finally {
  await pool.end();
}

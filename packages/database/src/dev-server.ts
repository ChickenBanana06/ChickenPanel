/**
 * Development database launcher: `pnpm --filter @nexpanel/database dev`
 * Starts embedded PostgreSQL on port 5490 with data under <repo>/.pgdata
 * and keeps running until Ctrl+C.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEmbeddedPostgres } from './embedded.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const dataDir = process.env.NEXPANEL_PGDATA ?? path.join(repoRoot, '.pgdata');
const port = Number(process.env.NEXPANEL_PGPORT ?? 5490);

const db = await startEmbeddedPostgres({ dataDir, port });
console.log(`[nexpanel-db] PostgreSQL ready at ${db.url}`);
console.log('[nexpanel-db] Press Ctrl+C to stop.');

// Keep the wrapper resident even when it attached to an already-running
// server (that code path holds no handles, so Node would otherwise exit).
setInterval(() => undefined, 60_000);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('[nexpanel-db] stopping...');
  await db.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

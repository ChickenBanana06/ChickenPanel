import { disconnectDb } from '@nexpanel/database';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

const config = loadConfig();
const { app, ctx } = await buildServer(config);

await ctx.tasks.recoverOnBoot();
ctx.nodes.start();

// Sweep expired sessions hourly.
const sessionSweep = setInterval(() => {
  void ctx.db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
}, 3600_000);
sessionSweep.unref();

await app.listen({ host: config.host, port: config.port });
app.log.info(`NexPanel API listening on http://${config.host}:${config.port}`);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`${signal} received, shutting down`);
  clearInterval(sessionSweep);
  ctx.nodes.stop();
  await app.close();
  await disconnectDb();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

import path from 'node:path';
import net from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

export interface EmbeddedDbOptions {
  dataDir: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

export interface RunningEmbeddedDb {
  url: string;
  stop: () => Promise<void>;
}

function isPortOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

/**
 * Start (initialising on first run) an embedded PostgreSQL server. Used for
 * development and for installs where no external PostgreSQL is configured.
 * Idempotent: if something is already listening on the port we assume the
 * database is already up and just return the URL.
 */
export async function startEmbeddedPostgres(opts: EmbeddedDbOptions): Promise<RunningEmbeddedDb> {
  const port = opts.port ?? 5490;
  const user = opts.user ?? 'nexpanel';
  const password = opts.password ?? 'nexpanel';
  const database = opts.database ?? 'nexpanel';
  const url = `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`;

  if (await isPortOpen(port)) {
    return { url, stop: async () => undefined };
  }

  const pg = new EmbeddedPostgres({
    databaseDir: path.resolve(opts.dataDir),
    user,
    password,
    port,
    persistent: true,
  });

  const initialized = await pgDataExists(opts.dataDir);
  if (!initialized) {
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase(database);
  } catch {
    // database already exists — fine
  }

  return {
    url,
    stop: async () => {
      await pg.stop();
    },
  };
}

async function pgDataExists(dataDir: string): Promise<boolean> {
  const { access } = await import('node:fs/promises');
  try {
    await access(path.join(path.resolve(dataDir), 'PG_VERSION'));
    return true;
  } catch {
    return false;
  }
}

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { newSecretToken } from '@nexpanel/shared';

export interface ApiConfig {
  host: string;
  port: number;
  /** Master secret: cookie signing + AES key derivation for stored API keys. */
  secret: string;
  dataDir: string;
  cookieName: string;
  sessionTtlDays: number;
  trustProxy: boolean;
  devCorsOrigin: string | null;
}

function defaultDataDir(): string {
  if (process.env.NEXPANEL_DATA_DIR) return process.env.NEXPANEL_DATA_DIR;
  const base =
    process.platform === 'win32'
      ? (process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'))
      : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'nexpanel');
}

/**
 * Load the master secret from env or from <dataDir>/secret.key, generating it
 * on first run so development does not require manual setup. In production
 * NEXPANEL_SECRET should be set explicitly.
 */
function loadSecret(dataDir: string): string {
  if (process.env.NEXPANEL_SECRET) {
    if (process.env.NEXPANEL_SECRET.length < 32) {
      throw new Error('NEXPANEL_SECRET must be at least 32 characters');
    }
    return process.env.NEXPANEL_SECRET;
  }
  const keyFile = path.join(dataDir, 'secret.key');
  try {
    const existing = fs.readFileSync(keyFile, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    // fall through and generate
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const secret = newSecretToken(48);
  fs.writeFileSync(keyFile, secret, { mode: 0o600 });
  return secret;
}

export function loadConfig(): ApiConfig {
  const dataDir = defaultDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  return {
    host: process.env.NEXPANEL_API_HOST ?? '127.0.0.1',
    port: Number(process.env.NEXPANEL_API_PORT ?? 4000),
    secret: loadSecret(dataDir),
    dataDir,
    cookieName: 'nexpanel_session',
    sessionTtlDays: Number(process.env.NEXPANEL_SESSION_TTL_DAYS ?? 30),
    trustProxy: process.env.NEXPANEL_TRUST_PROXY === 'true',
    devCorsOrigin: process.env.NODE_ENV === 'production' ? null : 'http://localhost:3000',
  };
}

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * AES-256-GCM encryption for secrets at rest (AI provider API keys).
 * Output format: v1:<iv b64>:<ciphertext b64>:<tag b64>
 */

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(`nexpanel-secret-v1:${secret}`).digest();
}

export function encryptSecret(plaintext: string, masterSecret: string): string {
  const key = deriveKey(masterSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${enc.toString('base64')}:${tag.toString('base64')}`;
}

export function decryptSecret(payload: string, masterSecret: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Invalid encrypted payload');
  const [, ivB64, dataB64, tagB64] = parts;
  const key = deriveKey(masterSecret);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64!, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64!, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64!, 'base64')), decipher.final()]).toString('utf8');
}

/** Mask an API key for display: keep first 4 and last 3 characters. */
export function maskSecret(value: string): string {
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}••••••••${value.slice(-3)}`;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

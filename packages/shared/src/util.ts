import { randomBytes, randomUUID, createHash } from 'node:crypto';

export function newId(prefix?: string): string {
  const id = randomUUID().replace(/-/g, '');
  return prefix ? `${prefix}_${id}` : id;
}

/** URL-safe opaque secret token (for sessions, node registration). */
export function newSecretToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Join a user-supplied relative path onto a sandbox root, rejecting absolute
 * paths and any traversal outside the root. Works with / and \ separators.
 * Returns the normalized relative path (POSIX separators) or null if unsafe.
 */
export function safeRelativePath(input: string): string | null {
  if (input.length === 0 || input.length > 4096) return null;
  // Reject NUL and other control characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(input)) return null;
  const normalized = input.replace(/\\/g, '/');
  // Absolute paths (POSIX or Windows drive/UNC) are not allowed
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.startsWith('//')) return null;
  const parts: string[] = [];
  for (const seg of normalized.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null; // escaping the root
      parts.pop();
      continue;
    }
    // Windows reserved device names would resolve outside normal files
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(seg)) return null;
    if (seg.endsWith('.') || seg.endsWith(' ')) return null;
    parts.push(seg);
  }
  if (parts.length === 0) return null;
  return parts.join('/');
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'n/a';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

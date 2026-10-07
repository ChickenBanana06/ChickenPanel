/**
 * Safe environment variables to inherit from the host agent process.
 * Strictly prevents leaking NEXPANEL_* secrets, DATABASE_URL, node tokens,
 * or cloud credentials into user application processes and commands.
 */
const ALLOWED_INHERITED_KEYS = new Set([
  'PATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'TMPDIR',
  'TEMP',
  'TMP',
  'TZ',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'ALLUSERSPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERPROFILE',
]);

const SENSITIVE_KEY_PATTERN = /(NEXPANEL_|DATABASE_URL|AWS_|AGENT_TOKEN|^TOKEN$|^API_KEY$|^SECRET|^PASSWORD)/i;

export function sanitizeEnvironment(customEnv?: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && ALLOWED_INHERITED_KEYS.has(key.toUpperCase())) {
      sanitized[key] = value;
    }
  }

  if (!sanitized.PATH) {
    sanitized.PATH = process.env.PATH ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
  }

  if (customEnv) {
    for (const [key, value] of Object.entries(customEnv)) {
      if (!SENSITIVE_KEY_PATTERN.test(key)) {
        sanitized[key] = value;
      }
    }
  }

  return sanitized;
}

/**
 * Platform permission identifiers. The backend enforces these on every API
 * route and on every AI tool invocation — the AI never bypasses them.
 */
export const PERMISSIONS = [
  'server.read',
  'server.create',
  'server.start',
  'server.stop',
  'server.delete',
  'server.console',
  'files.read',
  'files.write',
  'terminal.execute',
  'deployment.create',
  'database.create',
  'backups.manage',
  'node.manage',
  'users.manage',
  'ai.use',
  'ai.configure',
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  USER: [
    'server.read',
    'server.create',
    'server.start',
    'server.stop',
    'server.console',
    'files.read',
    'files.write',
    'deployment.create',
    'backups.manage',
    'ai.use',
  ],
  VIEWER: ['server.read', 'files.read'],
};

/** Actions that always require explicit user confirmation before an AI agent may run them. */
export const DANGEROUS_PERMISSIONS: readonly Permission[] = [
  'server.delete',
  'terminal.execute',
  'node.manage',
  'users.manage',
];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export function resolvePermissions(
  role: string,
  granted: readonly string[],
  revoked: readonly string[],
): Set<Permission> {
  const base = new Set<Permission>(ROLE_PERMISSIONS[role] ?? []);
  for (const p of granted) if (isPermission(p)) base.add(p);
  for (const p of revoked) if (isPermission(p)) base.delete(p);
  return base;
}

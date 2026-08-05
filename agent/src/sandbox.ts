import path from 'node:path';
import fs from 'node:fs';
import { safeRelativePath } from '@nexpanel/shared';

/**
 * Resolves scoped ids (an app id or "ws:<workspaceId>") to sandbox roots and
 * safely joins user paths inside them. Every filesystem operation the agent
 * performs goes through this — nothing may escape a sandbox root.
 */
export class Sandbox {
  constructor(private readonly dataDir: string) {
    fs.mkdirSync(this.appsDir, { recursive: true });
    fs.mkdirSync(this.workspacesDir, { recursive: true });
    fs.mkdirSync(this.backupsDir, { recursive: true });
  }

  get appsDir(): string {
    return path.join(this.dataDir, 'apps');
  }
  get workspacesDir(): string {
    return path.join(this.dataDir, 'workspaces');
  }
  get backupsDir(): string {
    return path.join(this.dataDir, 'backups');
  }

  private static checkId(id: string): string {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error(`Invalid id: ${id}`);
    return id;
  }

  /** Root directory for a scoped id ("<appId>" or "ws:<workspaceId>"). */
  rootFor(scopedId: string): string {
    if (scopedId.startsWith('ws:')) {
      return path.join(this.workspacesDir, Sandbox.checkId(scopedId.slice(3)));
    }
    return path.join(this.appsDir, Sandbox.checkId(scopedId));
  }

  appRoot(appId: string): string {
    return path.join(this.appsDir, Sandbox.checkId(appId));
  }

  workspaceRoot(workspaceId: string): string {
    return path.join(this.workspacesDir, Sandbox.checkId(workspaceId));
  }

  backupFile(appId: string, backupId: string): string {
    return path.join(this.backupsDir, Sandbox.checkId(appId), `${Sandbox.checkId(backupId)}.tgz`);
  }

  /**
   * Join a user-supplied relative path onto a sandbox root. Throws when the
   * path is absolute, traverses out, or contains unsafe segments. Defense in
   * depth: sanitize the relative path AND verify the resolved result stays
   * under the root.
   */
  resolve(scopedId: string, userPath: string): string {
    const root = this.rootFor(scopedId);
    if (userPath === '.' || userPath === '') return root;
    const safe = safeRelativePath(userPath);
    if (safe === null) throw new Error(`Unsafe path rejected: ${userPath}`);
    const resolved = path.resolve(root, safe);
    const rootResolved = path.resolve(root);
    if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
      throw new Error(`Path escapes sandbox: ${userPath}`);
    }
    return resolved;
  }
}

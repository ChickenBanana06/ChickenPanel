import fs from 'node:fs/promises';
import path from 'node:path';
import * as tar from 'tar';
import type { AppRuntimeSpec, ProvisionStep } from '@nexpanel/shared';
import type { Sandbox } from './sandbox.js';
import type { FileService } from './files.js';
import type { ExecService } from './exec.js';
import type { AppSupervisor } from './apps.js';

/**
 * Executes generic provisioning steps compiled by control-plane extensions.
 * Streams human-readable progress lines via onProgress.
 */
export class Provisioner {
  constructor(
    private readonly sandbox: Sandbox,
    private readonly files: FileService,
    private readonly exec: ExecService,
    private readonly apps: AppSupervisor,
  ) {}

  async provision(
    spec: AppRuntimeSpec,
    steps: ProvisionStep[],
    onProgress: (line: string) => void,
  ): Promise<void> {
    const appId = spec.appId;
    await fs.mkdir(this.sandbox.appRoot(appId), { recursive: true });
    this.apps.setSpec(spec);

    for (const [i, step] of steps.entries()) {
      const label = `[${i + 1}/${steps.length}]`;
      switch (step.op) {
        case 'mkdir':
          onProgress(`${label} creating directory ${step.path}`);
          await this.files.mkdir(appId, step.path);
          break;
        case 'write':
          onProgress(`${label} writing ${step.path}`);
          await this.files.write(appId, step.path, step.content, step.base64);
          break;
        case 'download': {
          onProgress(`${label} downloading ${step.url}`);
          const res = await this.files.download(appId, step.url, step.dest, step.sha256);
          onProgress(`${label} downloaded ${step.dest} (${Math.round(res.sizeBytes / 1048576)} MB)`);
          break;
        }
        case 'extract': {
          onProgress(`${label} extracting ${step.archive}`);
          const archive = this.sandbox.resolve(appId, step.archive);
          const dest = this.sandbox.resolve(appId, step.dest);
          await fs.mkdir(dest, { recursive: true });
          const realDest = await fs.realpath(dest);
          if (/\.zip$/i.test(step.archive)) {
            const AdmZip = (await import('adm-zip')).default;
            const zip = new AdmZip(archive);
            for (const entry of zip.getEntries()) {
              const entryName = entry.entryName;
              const target = path.resolve(realDest, entryName);
              if (target !== realDest && !target.startsWith(realDest + path.sep)) {
                throw new Error(`Zip entry escapes extraction directory: ${entryName}`);
              }
              if (entry.isDirectory) {
                await fs.mkdir(target, { recursive: true });
              } else {
                await fs.mkdir(path.dirname(target), { recursive: true });
                await fs.writeFile(target, entry.getData());
              }
            }
          } else if (/\.(tgz|tar\.gz|tar)$/i.test(step.archive)) {
            await tar.x({
              file: archive,
              cwd: realDest,
              filter: (entryPath, entry) => {
                if (path.isAbsolute(entryPath)) return false;
                const target = path.resolve(realDest, entryPath);
                if (target !== realDest && !target.startsWith(realDest + path.sep)) {
                  return false;
                }
                const e = entry as { type?: string; linkpath?: string };
                if (e.type === 'SymbolicLink' || e.type === 'Link') {
                  const linkTarget = path.resolve(path.dirname(target), e.linkpath ?? '');
                  if (linkTarget !== realDest && !linkTarget.startsWith(realDest + path.sep)) {
                    return false;
                  }
                }
                return true;
              },
            });
          } else {
            throw new Error('Only .tar/.tar.gz/.tgz/.zip archives are supported');
          }
          break;
        }
        case 'exec': {
          onProgress(`${label} running: ${step.command.join(' ')}`);
          const result = await this.exec.run(
            {
              scopedId: appId,
              command: step.command,
              cwd: step.cwd,
              env: spec.env,
              timeoutMs: step.timeoutMs,
              maxOutputBytes: 1048576,
              shell: false,
            },
            (_c, chunk) => onProgress(chunk),
          );
          if (result.exitCode !== 0) {
            throw new Error(`Provision step failed (exit ${result.exitCode}): ${step.command.join(' ')}`);
          }
          break;
        }
      }
    }
    onProgress('provisioning finished');
  }
}

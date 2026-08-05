import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import type { FileEntry } from '@nexpanel/shared';
import type { Sandbox } from './sandbox.js';

const MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB
const SEARCH_MAX_FILE_BYTES = 2 * 1024 * 1024;
const SEARCH_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', 'libraries', 'versions', 'cache']);

export class FileService {
  constructor(private readonly sandbox: Sandbox) {}

  async list(scopedId: string, userPath: string): Promise<{ entries: FileEntry[] }> {
    const dir = this.sandbox.resolve(scopedId, userPath);
    const names = await fs.readdir(dir, { withFileTypes: true });
    const entries: FileEntry[] = [];
    for (const d of names.slice(0, 2000)) {
      try {
        const full = path.join(dir, d.name);
        const st = await fs.stat(full);
        entries.push({
          name: d.name,
          path: userPath === '.' || userPath === '' ? d.name : `${userPath.replace(/\/$/, '')}/${d.name}`,
          type: d.isDirectory() ? 'directory' : 'file',
          sizeBytes: d.isDirectory() ? 0 : st.size,
          modifiedAt: st.mtime.toISOString(),
          mode: process.platform === 'win32' ? null : (st.mode & 0o777).toString(8),
        });
      } catch {
        // race with deletion — skip
      }
    }
    entries.sort((a, b) => (a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name)));
    return { entries };
  }

  async read(scopedId: string, userPath: string, maxBytes: number): Promise<{ content: string; truncated: boolean; sizeBytes: number }> {
    const file = this.sandbox.resolve(scopedId, userPath);
    const st = await fs.stat(file);
    if (!st.isFile()) throw new Error('Not a file');
    const truncated = st.size > maxBytes;
    const handle = await fs.open(file, 'r');
    try {
      const buf = Buffer.alloc(Math.min(st.size, maxBytes));
      await handle.read(buf, 0, buf.length, 0);
      return { content: buf.toString('utf8'), truncated, sizeBytes: st.size };
    } finally {
      await handle.close();
    }
  }

  async write(scopedId: string, userPath: string, content: string, base64: boolean): Promise<void> {
    const file = this.sandbox.resolve(scopedId, userPath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, base64 ? Buffer.from(content, 'base64') : content, base64 ? undefined : 'utf8');
  }

  async delete(scopedId: string, userPath: string): Promise<void> {
    const target = this.sandbox.resolve(scopedId, userPath);
    if (path.resolve(target) === path.resolve(this.sandbox.rootFor(scopedId))) {
      throw new Error('Refusing to delete the sandbox root');
    }
    await fs.rm(target, { recursive: true, force: true });
  }

  async rename(scopedId: string, from: string, to: string): Promise<void> {
    const src = this.sandbox.resolve(scopedId, from);
    const dest = this.sandbox.resolve(scopedId, to);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(src, dest);
  }

  async mkdir(scopedId: string, userPath: string): Promise<void> {
    await fs.mkdir(this.sandbox.resolve(scopedId, userPath), { recursive: true });
  }

  async stat(scopedId: string, userPath: string): Promise<FileEntry> {
    const target = this.sandbox.resolve(scopedId, userPath);
    const st = await fs.stat(target);
    return {
      name: path.basename(target),
      path: userPath,
      type: st.isDirectory() ? 'directory' : 'file',
      sizeBytes: st.size,
      modifiedAt: st.mtime.toISOString(),
      mode: process.platform === 'win32' ? null : (st.mode & 0o777).toString(8),
    };
  }

  async search(
    scopedId: string,
    userPath: string,
    query: string,
    maxResults: number,
  ): Promise<{ matches: { path: string; line: number; text: string }[]; truncated: boolean }> {
    const root = this.sandbox.resolve(scopedId, userPath);
    const rootBase = this.sandbox.rootFor(scopedId);
    const matches: { path: string; line: number; text: string }[] = [];
    const lowerQuery = query.toLowerCase();

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (matches.length >= maxResults || depth > 12) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (matches.length >= maxResults) return;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!SEARCH_SKIP_DIRS.has(e.name)) await walk(full, depth + 1);
        } else if (e.isFile()) {
          try {
            const st = await fs.stat(full);
            if (st.size > SEARCH_MAX_FILE_BYTES) continue;
            const content = await fs.readFile(full, 'utf8');
            if (content.includes('\u0000')) continue; // binary
            const lines = content.split('\n');
            for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
              if (lines[i]!.toLowerCase().includes(lowerQuery)) {
                matches.push({
                  path: path.relative(rootBase, full).replace(/\\/g, '/'),
                  line: i + 1,
                  text: lines[i]!.slice(0, 300),
                });
              }
            }
          } catch {
            // unreadable — skip
          }
        }
      }
    };
    await walk(root, 0);
    return { matches, truncated: matches.length >= maxResults };
  }

  async download(scopedId: string, url: string, dest: string, sha256?: string): Promise<{ sizeBytes: number }> {
    const target = this.sandbox.resolve(scopedId, dest);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) from ${url}`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_DOWNLOAD_BYTES) throw new Error('Download exceeds size limit');

    const hash = sha256 ? createHash('sha256') : null;
    let written = 0;
    const counter = new (await import('node:stream')).Transform({
      transform(chunk: Buffer, _enc, cb) {
        written += chunk.length;
        if (written > MAX_DOWNLOAD_BYTES) return cb(new Error('Download exceeds size limit'));
        hash?.update(chunk);
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(target));
    if (hash && sha256) {
      const actual = hash.digest('hex');
      if (actual !== sha256.toLowerCase()) {
        await fs.rm(target, { force: true });
        throw new Error(`Checksum mismatch for ${dest}: expected ${sha256}, got ${actual}`);
      }
    }
    return { sizeBytes: written };
  }
}

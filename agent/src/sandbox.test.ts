import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Sandbox } from './sandbox.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexpanel-sbx-'));
const sandbox = new Sandbox(tmp);

test('resolves app paths inside the sandbox', () => {
  const p = sandbox.resolve('app123', 'plugins/x.jar');
  assert.ok(p.startsWith(path.join(tmp, 'apps', 'app123')));
});

test('resolves workspace scoped ids', () => {
  const p = sandbox.resolve('ws:wsabc', 'src/main.ts');
  assert.ok(p.startsWith(path.join(tmp, 'workspaces', 'wsabc')));
});

test('rejects traversal', () => {
  assert.throws(() => sandbox.resolve('app123', '../other-app/secret'));
  assert.throws(() => sandbox.resolve('app123', '..\\..\\windows'));
  assert.throws(() => sandbox.resolve('app123', '/etc/passwd'));
  assert.throws(() => sandbox.resolve('app123', 'C:\\Windows\\system32'));
});

test('rejects malicious scoped ids', () => {
  assert.throws(() => sandbox.resolve('../evil', 'x'));
  assert.throws(() => sandbox.resolve('ws:../evil', 'x'));
  assert.throws(() => sandbox.rootFor('a/b'));
});

test('root path resolution for "." stays at root', () => {
  assert.equal(sandbox.resolve('app123', '.'), fs.realpathSync(path.join(tmp, 'apps', 'app123')));
});

test('rejects symlink traversal outside sandbox', () => {
  const appRoot = sandbox.appRoot('app123');
  fs.mkdirSync(appRoot, { recursive: true });

  const outsideTarget = path.join(tmp, 'outside-secret.txt');
  fs.writeFileSync(outsideTarget, 'classified');

  const symlinkPath = path.join(appRoot, 'symlink-out');
  try {
    fs.unlinkSync(symlinkPath);
  } catch {}
  fs.symlinkSync(outsideTarget, symlinkPath);

  assert.throws(() => sandbox.resolve('app123', 'symlink-out'), /Symlink escapes sandbox/);

  // Directory symlink
  const symlinkDir = path.join(appRoot, 'symlink-dir');
  try {
    fs.unlinkSync(symlinkDir);
  } catch {}
  fs.symlinkSync(tmp, symlinkDir);

  assert.throws(() => sandbox.resolve('app123', 'symlink-dir/outside-secret.txt'), /Symlink escapes sandbox/);
});

test('SSRF isPrivateOrBlockedIP correctly identifies dangerous addresses', async () => {
  const { isPrivateOrBlockedIP } = await import('./ssrf.js');
  // Loopback
  assert.equal(isPrivateOrBlockedIP('127.0.0.1'), true);
  assert.equal(isPrivateOrBlockedIP('127.0.1.1'), true);
  assert.equal(isPrivateOrBlockedIP('::1'), true);
  // Cloud metadata
  assert.equal(isPrivateOrBlockedIP('169.254.169.254'), true);
  assert.equal(isPrivateOrBlockedIP('169.254.1.1'), true);
  // Private subnets
  assert.equal(isPrivateOrBlockedIP('10.0.0.1'), true);
  assert.equal(isPrivateOrBlockedIP('192.168.1.100'), true);
  assert.equal(isPrivateOrBlockedIP('172.16.0.1'), true);
  assert.equal(isPrivateOrBlockedIP('172.31.255.255'), true);
  // Public addresses
  assert.equal(isPrivateOrBlockedIP('8.8.8.8'), false);
  assert.equal(isPrivateOrBlockedIP('1.1.1.1'), false);
});

test('SSRF assertSafeUrl blocks local and metadata URLs', async () => {
  const { assertSafeUrl } = await import('./ssrf.js');
  await assert.rejects(() => assertSafeUrl('http://127.0.0.1:3000'), /SSRF rejected/);
  await assert.rejects(() => assertSafeUrl('http://169.254.169.254/latest/meta-data'), /SSRF rejected/);
  await assert.rejects(() => assertSafeUrl('http://localhost/api'), /SSRF rejected/);
  await assert.rejects(() => assertSafeUrl('file:///etc/shadow'), /SSRF rejected/);
  await assert.rejects(() => assertSafeUrl('ftp://example.com'), /SSRF rejected/);
});

test('sanitizeEnvironment strips sensitive keys from child process env', async () => {
  const { sanitizeEnvironment } = await import('./env.js');
  const dirty = {
    USER_VAR: 'hello',
    DATABASE_URL: 'postgres://root:pass@localhost:5432/db',
    NEXPANEL_COOKIE_SECRET: 'supersecret',
    TOKEN: 'sensitive-token',
    API_KEY: 'sk-12345',
    AWS_SECRET_ACCESS_KEY: 'aws-secret',
    SAFE_FLAG: '1',
  };
  const cleaned = sanitizeEnvironment(dirty);
  assert.equal(cleaned.USER_VAR, 'hello');
  assert.equal(cleaned.SAFE_FLAG, '1');
  assert.equal(cleaned.DATABASE_URL, undefined);
  assert.equal(cleaned.NEXPANEL_COOKIE_SECRET, undefined);
  assert.equal(cleaned.TOKEN, undefined);
  assert.equal(cleaned.API_KEY, undefined);
  assert.equal(cleaned.AWS_SECRET_ACCESS_KEY, undefined);
});


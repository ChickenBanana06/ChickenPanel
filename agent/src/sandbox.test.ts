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
  assert.equal(sandbox.resolve('app123', '.'), path.join(tmp, 'apps', 'app123'));
});

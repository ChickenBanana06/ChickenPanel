import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeRelativePath } from './util.js';

test('safeRelativePath allows normal relative paths', () => {
  assert.equal(safeRelativePath('plugins/MyPlugin.jar'), 'plugins/MyPlugin.jar');
  assert.equal(safeRelativePath('a/./b'), 'a/b');
  assert.equal(safeRelativePath('a\\b\\c.txt'), 'a/b/c.txt');
  assert.equal(safeRelativePath('a/b/../c'), 'a/c');
  assert.equal(safeRelativePath('my folder/file.txt'), 'my folder/file.txt');
});

test('safeRelativePath rejects traversal and absolute paths', () => {
  assert.equal(safeRelativePath('../etc/passwd'), null);
  assert.equal(safeRelativePath('a/../../b'), null);
  assert.equal(safeRelativePath('/etc/passwd'), null);
  assert.equal(safeRelativePath('C:\\Windows\\system32'), null);
  assert.equal(safeRelativePath('\\\\server\\share'), null);
  assert.equal(safeRelativePath('..\\..\\secret'), null);
  assert.equal(safeRelativePath('a/b '), null);
  assert.equal(safeRelativePath('a/b.'), null);
  assert.equal(safeRelativePath(''), null);
  assert.equal(safeRelativePath('.'), null);
  assert.equal(safeRelativePath('a\u0000b'), null);
});

test('safeRelativePath rejects Windows reserved names', () => {
  assert.equal(safeRelativePath('CON'), null);
  assert.equal(safeRelativePath('sub/nul.txt'), null);
  assert.equal(safeRelativePath('aux.log'), null);
});

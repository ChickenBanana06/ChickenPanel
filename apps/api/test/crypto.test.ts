import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret, maskSecret } from '../src/lib/crypto.js';

const SECRET = 'a-master-secret-that-is-long-enough-123456';

test('encrypt/decrypt roundtrip', () => {
  const enc = encryptSecret('sk-my-api-key', SECRET);
  assert.notEqual(enc, 'sk-my-api-key');
  assert.ok(enc.startsWith('v1:'));
  assert.equal(decryptSecret(enc, SECRET), 'sk-my-api-key');
});

test('decrypt fails with wrong master secret', () => {
  const enc = encryptSecret('sk-my-api-key', SECRET);
  assert.throws(() => decryptSecret(enc, 'wrong-master-secret-also-long-enough-xx'));
});

test('decrypt fails on tampered ciphertext', () => {
  const enc = encryptSecret('sk-my-api-key', SECRET);
  const parts = enc.split(':');
  const data = Buffer.from(parts[2]!, 'base64');
  data[0] = data[0]! ^ 0xff;
  parts[2] = data.toString('base64');
  assert.throws(() => decryptSecret(parts.join(':'), SECRET));
});

test('different encryptions of same plaintext differ (random IV)', () => {
  assert.notEqual(encryptSecret('same', SECRET), encryptSecret('same', SECRET));
});

test('maskSecret hides the middle', () => {
  const masked = maskSecret('sk-abcdefghijklmnop-xyz');
  assert.ok(!masked.includes('abcdefghijklmnop'));
  assert.ok(masked.startsWith('sk-a'));
  assert.ok(masked.endsWith('xyz'));
  assert.equal(maskSecret('short'), '••••••••');
});

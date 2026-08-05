import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets } from '../src/lib/audit.js';
import { resolvePermissions, safeRelativePath } from '@nexpanel/shared';
import { parseCommandLine } from '../src/extensions/builtin.js';
test('redactSecrets removes secret-looking fields recursively', () => {
    const input = {
        name: 'test',
        apiKey: 'sk-secret',
        nested: { password: 'hunter2', TOKEN: 'abc', fine: 'ok', authorization: 'Bearer x' },
        list: [{ api_key: 'x' }],
    };
    const out = redactSecrets(input);
    assert.equal(out.name, 'test');
    assert.equal(out.apiKey, '[redacted]');
    const nested = out.nested;
    assert.equal(nested.password, '[redacted]');
    assert.equal(nested.TOKEN, '[redacted]');
    assert.equal(nested.authorization, '[redacted]');
    assert.equal(nested.fine, 'ok');
    assert.equal(out.list[0].api_key, '[redacted]');
});
test('role permissions resolve with grants and revocations', () => {
    const admin = resolvePermissions('ADMIN', [], []);
    assert.ok(admin.has('users.manage'));
    assert.ok(admin.has('terminal.execute'));
    const user = resolvePermissions('USER', [], []);
    assert.ok(user.has('server.create'));
    assert.ok(!user.has('users.manage'));
    assert.ok(!user.has('terminal.execute'));
    const granted = resolvePermissions('USER', ['terminal.execute'], []);
    assert.ok(granted.has('terminal.execute'));
    const revoked = resolvePermissions('ADMIN', [], ['server.delete']);
    assert.ok(!revoked.has('server.delete'));
    const viewer = resolvePermissions('VIEWER', [], []);
    assert.ok(viewer.has('server.read'));
    assert.ok(!viewer.has('server.start'));
});
test('unknown roles have no permissions', () => {
    assert.equal(resolvePermissions('HACKER', [], []).size, 0);
});
test('parseCommandLine handles quotes', () => {
    assert.deepEqual(parseCommandLine('node -e "console.log(1)"'), ['node', '-e', 'console.log(1)']);
    assert.deepEqual(parseCommandLine("sh -c 'echo hi there'"), ['sh', '-c', 'echo hi there']);
    assert.deepEqual(parseCommandLine('npm start'), ['npm', 'start']);
});
test('path traversal blocked at the API layer helper', () => {
    assert.equal(safeRelativePath('../../../etc/shadow'), null);
    // Encoded traversal is rejected too (trailing-dot segments are refused outright).
    assert.equal(safeRelativePath('..%2F..'), null);
    assert.equal(safeRelativePath('a%2Fb'), 'a%2Fb'); // %2F elsewhere is just a literal file name
    assert.equal(safeRelativePath('plugins/../..'), null);
});
//# sourceMappingURL=security.test.js.map
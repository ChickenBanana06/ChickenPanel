/**
 * End-to-end smoke test against a running API (and optionally agent).
 * Usage: node scripts/e2e-smoke.mjs [--with-agent]
 * Requires: API on :4000, embedded postgres running.
 */
const BASE = process.env.NEXPANEL_API ?? 'http://127.0.0.1:4000';
let cookie = '';

async function api(method, path, body) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-nexpanel-csrf': '1',
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log(`ok: ${msg}`);
}

const health = await api('GET', '/health');
assert(health.status === 200 && health.json.ok, 'health endpoint responds');

// Register first admin (or login if already present).
// Override the admin password with NEXPANEL_ADMIN_PW if it has been changed.
const ADMIN_PW = process.env.NEXPANEL_ADMIN_PW ?? 'super-secret-password-1';
const uniq = Date.now().toString(36);
let reg = await api('POST', '/auth/register', {
  username: 'admin',
  email: 'admin@example.com',
  password: ADMIN_PW,
});
if (reg.status !== 200) {
  const login = await api('POST', '/auth/login', { username: 'admin', password: ADMIN_PW });
  assert(login.status === 200, `login as existing admin (${JSON.stringify(login.json)})`);
} else {
  assert(reg.json.user.role === 'ADMIN', 'first user becomes ADMIN');
}

const me = await api('GET', '/auth/me');
assert(me.status === 200 && me.json.user.permissions.includes('node.manage'), 'me returns admin permissions');

// CSRF check: mutating request without header must fail
{
  const res = await fetch(`${BASE}/api/v1/nodes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'x' + uniq }),
  });
  assert(res.status === 403, 'CSRF header is enforced on mutations');
}

// Unauthenticated access must fail
{
  const res = await fetch(`${BASE}/api/v1/nodes`);
  assert(res.status === 401, 'unauthenticated request rejected');
}

// Node registration: reuse an already-connected node when available.
let nodeId;
const existing = await api('GET', '/nodes');
const connected = existing.json.nodes?.find((n) => n.connected);
if (connected) {
  nodeId = connected.id;
  console.log(`ok: reusing connected node ${connected.name}`);
} else {
  const nodeRes = await api('POST', '/nodes', { name: `local-${uniq}` });
  assert(nodeRes.status === 200 && nodeRes.json.registrationToken?.startsWith('npn_'), 'node created with token');
  nodeId = nodeRes.json.node.id;
  console.log(`NODE_ID=${nodeId}`);
  console.log(`NODE_TOKEN=${nodeRes.json.registrationToken}`);
}

if (process.argv.includes('--with-agent')) {
  // Wait for the agent to connect (it must be started with the token above)
  let online = false;
  for (let i = 0; i < 30; i++) {
    const nodes = await api('GET', '/nodes');
    const n = nodes.json.nodes.find((n) => n.id === nodeId);
    if (n?.connected) { online = true; break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert(online, 'agent connected and node is online');

  // Create a trivial custom application
  const appRes = await api('POST', '/apps', {
    name: `smoke-${uniq}`,
    type: 'custom',
    nodeId,
    config: { startCommand: 'node -e "setInterval(()=>console.log(new Date().toISOString()),1000)"' },
  });
  assert(appRes.status === 200, `application created (${JSON.stringify(appRes.json)})`);
  const appId = appRes.json.application.id;
  const taskId = appRes.json.taskId;

  // Wait for provisioning task
  let task;
  for (let i = 0; i < 30; i++) {
    const t = await api('GET', `/tasks/${taskId}`);
    task = t.json.task;
    if (task.status === 'completed' || task.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert(task.status === 'completed', `provisioning task completed (${task.status}: ${task.error ?? ''})`);

  // Start the app
  const start = await api('POST', `/apps/${appId}/start`);
  assert(start.status === 200, 'application started');
  await new Promise((r) => setTimeout(r, 4000));

  const logs = await api('GET', `/apps/${appId}/logs?lines=50`);
  assert(logs.status === 200 && logs.json.lines.length > 0, `live logs received (${logs.json.lines?.length} lines)`);

  const detail = await api('GET', `/apps/${appId}`);
  assert(detail.json.application.status === 'running', 'application status is running');

  // Path traversal must be blocked
  const evil = await api('GET', `/apps/${appId}/files/content?path=..%2F..%2Fsecret.txt`);
  assert(evil.status === 400, 'path traversal rejected');

  // File write/read roundtrip
  const write = await api('PUT', `/apps/${appId}/files/content`, { path: 'hello.txt', content: 'from nexpanel' });
  assert(write.status === 200, 'file written');
  const read = await api('GET', `/apps/${appId}/files/content?path=hello.txt`);
  assert(read.json.content === 'from nexpanel', 'file read back');

  // Stop
  const stop = await api('POST', `/apps/${appId}/stop`);
  assert(stop.status === 200, 'application stopped');
  await new Promise((r) => setTimeout(r, 2000));

  // Delete
  const del = await api('DELETE', `/apps/${appId}`);
  assert(del.status === 200, 'application delete requested');
}

console.log('\nSMOKE TEST PASSED');

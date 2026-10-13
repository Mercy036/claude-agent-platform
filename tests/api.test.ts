import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { readConfig } from '../apps/api/src/config';
import { buildServer } from '../apps/api/src/server';
import { consumeResponse } from '../apps/cli/src/stream';

const config = readConfig({ JWT_SECRET: 'test-only-random-secret-20261013-with-entropy' });
async function fixture(t: test.TestContext) {
  const user = { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.com', name: 'Admin', password: await bcrypt.hash('valid-password', 4), role: 'ADMIN', authVersion: 0, status: 'ACTIVE' };
  let estimated = 0;
  let reserved = 0;
  let cancelled = 0;
  const services: any = {
    database: { user: { findUnique: async () => user, findUniqueOrThrow: async () => user } },
    reserve: async () => { reserved++; return { id: user.id }; },
    cancel: async () => { cancelled++; }, lock: async () => {}, estimate: async () => { estimated++; return 1000; },
    queue: { queue: { add: async () => { throw new Error('Redis unavailable'); }, close: async () => {} }, connection: { quit: async () => {} } },
    events: { publish: () => async () => {}, connection: { quit: async () => {} } },
  };
  const server = await buildServer(config, services);
  t.after(() => server.close());
  return { server, user, services, counts: () => ({ estimated, reserved, cancelled }) };
}
test('startup rejects absent, weak and known default signing secrets', () => {
  assert.throws(() => readConfig({}), /JWT_SECRET/);
  assert.throws(() => readConfig({ JWT_SECRET: 'super-secret-hackathon-key-change-in-production' }), /JWT_SECRET/);
  assert.throws(() => readConfig({ JWT_SECRET: config.jwtSecret, CORS_ORIGINS: '*' }), /trusted origins/);
});
test('login only accepts the password, rejects hash-as-password and expires tokens', async t => {
  const { server, user } = await fixture(t);
  const login = await server.inject({ method: 'POST', url: '/api/auth/login', payload: { email: user.email, password: 'valid-password' } });
  assert.equal(login.statusCode, 200);
  const token = login.json().token;
  const claims: any = server.jwt.decode(token);
  assert.equal(claims.exp - claims.iat, 8 * 60 * 60);
  assert.equal((await server.inject({ method: 'POST', url: '/api/auth/login', payload: { email: user.email, password: user.password } })).statusCode, 401);
  assert.equal((await server.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } })).statusCode, 200);
  user.authVersion++;
  assert.equal((await server.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } })).statusCode, 401);
});
test('disabled users and stale admin roles are checked against current database state', async t => {
  const { server, user } = await fixture(t);
  const token = server.jwt.sign({ id: user.id, authVersion: 0 });
  user.role = 'PARTICIPANT';
  assert.equal((await server.inject({ url: '/api/admin/users', headers: { authorization: `Bearer ${token}` } })).statusCode, 403);
  user.status = 'DISABLED';
  assert.equal((await server.inject({ method: 'POST', url: '/api/agent/run', headers: { authorization: `Bearer ${token}` }, payload: { task: 'hello', files: [] } })).statusCode, 401);
});
test('invalid project checksums reject before provider estimation or quota reservation', async t => {
  const { server, user, counts } = await fixture(t);
  const token = server.jwt.sign({ id: user.id, authVersion: 0 });
  const result = await server.inject({ method: 'POST', url: '/api/agent/run', headers: { authorization: `Bearer ${token}` }, payload: { task: 'edit', files: [{ path: 'a.ts', content: 'code', sha256: 'a'.repeat(64) }] } });
  assert.equal(result.statusCode, 400);
  assert.deepEqual(counts(), { estimated: 0, reserved: 0, cancelled: 0 });
});
test('enqueue failure cancels the reserved task and returns an HTTP error', async t => {
  const { server, user, counts } = await fixture(t);
  const token = server.jwt.sign({ id: user.id, authVersion: 0 });
  const result = await server.inject({ method: 'POST', url: '/api/agent/run', headers: { authorization: `Bearer ${token}` }, payload: { task: 'edit', files: [] } });
  assert.equal(result.statusCode, 500);
  assert.deepEqual(counts(), { estimated: 1, reserved: 1, cancelled: 1 });
});

test('run endpoint enqueues the session and replays persisted SSE events in order', async t => {
  const { server, user, services, counts } = await fixture(t);
  const messages: [string, string[]][] = [];
  let enqueued = false;
  services.events.publish = () => async (event: string, data: unknown) => {
    messages.push([`${messages.length + 1}-0`, ['message', JSON.stringify({ event, data })]]);
  };
  services.events.connection.xrange = async (_key: string, after: string) => messages.filter(([id]) => Number(id.split('-')[0]) > Number(after.slice(1).split('-')[0]));
  services.queue.queue.add = async (_name: string, task: { sessionId: string }) => {
    enqueued = true;
    assert.equal(task.sessionId, user.id);
    await services.events.publish(task.sessionId)('DELTA', { text: 'Generated response' });
    await services.events.publish(task.sessionId)('COMPLETED', { success: true });
  };
  const token = server.jwt.sign({ id: user.id, authVersion: 0 });
  const result = await server.inject({ method: 'POST', url: '/api/agent/run', headers: { authorization: `Bearer ${token}`, origin: 'http://localhost:3000' }, payload: { task: 'edit', files: [] } });
  assert.equal(result.statusCode, 200);
  assert.equal(enqueued, true);
  assert.equal(result.headers['access-control-allow-origin'], 'http://localhost:3000');
  const events: string[] = [];
  await consumeResponse(new Response(result.body, { headers: { 'Content-Type': 'text/event-stream' } }), event => events.push(event.event));
  assert.deepEqual(events, ['QUEUED', 'DELTA', 'COMPLETED']);
  assert.deepEqual(counts(), { estimated: 1, reserved: 1, cancelled: 0 });
});

test('invalid unauthenticated requests never reserve quota', async t => {
  const { server, counts } = await fixture(t);
  assert.equal((await server.inject({ method: 'POST', url: '/api/agent/run', payload: { task: 'test' } })).statusCode, 401);
  assert.deepEqual(counts(), { estimated: 0, reserved: 0, cancelled: 0 });
});

test('login throttles repeated attempts without blocking other emails on a shared IP', async t => {
  const { server, user } = await fixture(t);
  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal((await server.inject({ method: 'POST', url: '/api/auth/login', payload: { email: user.email, password: 'wrong-password' } })).statusCode, 401);
  }
  assert.equal((await server.inject({ method: 'POST', url: '/api/auth/login', payload: { email: user.email, password: 'wrong-password' } })).statusCode, 429);
  assert.equal((await server.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'another@example.com', password: 'wrong-password' } })).statusCode, 401);
});

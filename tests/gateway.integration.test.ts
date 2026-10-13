import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

test('PostgreSQL team dollar credits, hashed keys, concurrent requests and recovery', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.match(url.pathname, /_test$/);
  process.env.DATABASE_URL = url.toString();
  const { db } = await import('../packages/database/src/index');
  const { generateTeamKey, authenticateTeamKey, reserveGateway, settleGateway, gatewayLock, recoverGatewayReservations } = await import('../packages/database/src/gateway');
  const team = await db.team.create({ data: { name: `gateway-${randomUUID()}`, creditMicros: 10000, maxConcurrentRequests: 2 } });
  const generated = generateTeamKey();
  const key = await db.teamApiKey.create({ data: { teamId: team.id, name: 'test', keyHash: generated.keyHash, prefix: generated.prefix } });
  t.after(async () => {
    await db.gatewayRequest.deleteMany({ where: { teamId: team.id } });
    await db.teamApiKey.deleteMany({ where: { teamId: team.id } });
    await db.teamCreditChange.deleteMany({ where: { teamId: team.id } });
    await db.team.delete({ where: { id: team.id } });
    await db.$disconnect();
  });
  assert.equal((await authenticateTeamKey(generated.secret)).teamId, team.id);
  assert.equal(Object.values(key).includes(generated.secret), false);
  const budget = { model: 'test', inputBudget: 5000, maxOutputTokens: 1000, inputRateMicros: 1, outputRateMicros: 5, globalConcurrency: 5 };
  const results = await Promise.allSettled([reserveGateway(key.id, budget), reserveGateway(key.id, budget)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const record = (results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<any>).value;
  assert.equal((await db.team.findUniqueOrThrow({ where: { id: team.id } })).reservedMicros, 10000);
  await Promise.all(Array.from({ length: 5 }, () => settleGateway(record.id, 'COMPLETED', { inputTokens: 100, outputTokens: 100, exact: true })));
  let current = await db.team.findUniqueOrThrow({ where: { id: team.id } });
  assert.equal(current.spentMicros, 600); assert.equal(current.reservedMicros, 0);
  const partial = await reserveGateway(key.id, { ...budget, inputBudget: 1000, maxOutputTokens: 100 });
  await settleGateway(partial.id, 'CANCELLED', { inputTokens: 100, outputTokens: 10, exact: false });
  current = await db.team.findUniqueOrThrow({ where: { id: team.id } });
  assert.equal(current.spentMicros, 2100); assert.equal(current.reservedMicros, 0);
  assert.equal((await db.gatewayRequest.findUniqueOrThrow({ where: { id: partial.id } })).estimated, true);
  const abandoned = await reserveGateway(key.id, { ...budget, inputBudget: 100, maxOutputTokens: 100 });
  await db.gatewayRequest.update({ where: { id: abandoned.id }, data: { status: 'RUNNING', lastActivity: new Date(Date.now() - 4 * 60 * 1000) } });
  await recoverGatewayReservations();
  assert.equal((await db.team.findUniqueOrThrow({ where: { id: team.id } })).spentMicros, 2700);
  await gatewayLock(tx => tx.teamApiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } }));
  await assert.rejects(authenticateTeamKey(generated.secret), /revoked/);
  await assert.rejects(reserveGateway(key.id, budget), /revoked/);
});

test('PostgreSQL enforces gateway concurrency and rate limits across teams and keys', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const url = new URL(process.env.TEST_DATABASE_URL!); assert.match(url.pathname, /_test$/); process.env.DATABASE_URL = url.toString();
  const { db } = await import('../packages/database/src/index');
  const { generateTeamKey, reserveGateway, settleGateway } = await import('../packages/database/src/gateway');
  const team = await db.team.create({ data: { name: `limits-${randomUUID()}`, creditMicros: 10000000, maxConcurrentRequests: 1, requestsPerMinute: 1 } });
  const generated = generateTeamKey();
  const key = await db.teamApiKey.create({ data: { teamId: team.id, name: 'test', keyHash: generated.keyHash, prefix: generated.prefix } });
  t.after(async () => {
    await db.gatewayRequest.deleteMany({ where: { teamId: team.id } }); await db.teamApiKey.deleteMany({ where: { teamId: team.id } }); await db.team.delete({ where: { id: team.id } }); await db.$disconnect();
  });
  const budget = { model: 'test', inputBudget: 100, maxOutputTokens: 100, inputRateMicros: 1, outputRateMicros: 5, globalConcurrency: 1 };
  const first = await reserveGateway(key.id, budget);
  await assert.rejects(reserveGateway(key.id, budget), /rate limit/);
  await settleGateway(first.id, 'FAILED');
  await assert.rejects(reserveGateway(key.id, budget), /rate limit/);
  await db.gatewayRequest.update({ where: { id: first.id }, data: { createdAt: new Date(Date.now() - 61000) } });
  const next = await reserveGateway(key.id, budget);
  await db.team.update({ where: { id: team.id }, data: { status: 'DISABLED' } });
  await assert.rejects(reserveGateway(key.id, budget), /disabled/);
  await settleGateway(next.id, 'FAILED');
  assert.equal((await db.team.findUniqueOrThrow({ where: { id: team.id } })).reservedMicros, 0);
});

test('organizer routes issue one-time keys, top up balances and revoke access', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const url = new URL(process.env.TEST_DATABASE_URL!); assert.match(url.pathname, /_test$/); process.env.DATABASE_URL = url.toString();
  const { db, withQuotaLock, reserveSession, cancelSession } = await import('@claude-hackathon/database');
  const { buildServer } = await import('../apps/api/src/server');
  const { readConfig } = await import('../apps/api/src/config');
  const admin = await db.user.create({ data: { name: 'Organizer', email: `organizer-${randomUUID()}@example.com`, password: 'not-used', role: 'ADMIN' } });
  const server = await buildServer(readConfig({ JWT_SECRET: 'integration-test-only-secret-long-enough-for-signing' }), {
    database: db, lock: withQuotaLock, reserve: reserveSession, cancel: cancelSession,
    estimate: async () => 100, queue: null, events: null,
  });
  let teamId: string | undefined;
  t.after(async () => {
    await server.close();
    if (teamId) { await db.teamCreditChange.deleteMany({ where: { teamId } }); await db.teamApiKey.deleteMany({ where: { teamId } }); await db.team.delete({ where: { id: teamId } }); }
    await db.user.delete({ where: { id: admin.id } }); await db.$disconnect();
  });
  const token = server.jwt.sign({ id: admin.id, authVersion: 0 });
  const headers = { authorization: `Bearer ${token}` };
  assert.equal((await server.inject({ method: 'POST', url: '/api/admin/teams', payload: { name: 'unauthorized' } })).statusCode, 401);
  const created = await server.inject({ method: 'POST', url: '/api/admin/teams', headers, payload: { name: `event-${randomUUID()}` } });
  assert.equal(created.statusCode, 200);
  const data = created.json(); teamId = data.team.id;
  assert.equal(data.balance.creditUSD, '10.000000');
  const stored = await db.teamApiKey.findUniqueOrThrow({ where: { id: data.key.id } });
  assert.notEqual(stored.keyHash, data.apiKey);
  const list = (await server.inject({ url: '/api/admin/teams', headers })).json();
  assert.equal(JSON.stringify(list).includes(data.apiKey), false); assert.equal(JSON.stringify(list).includes(stored.keyHash), false);
  const balance = await server.inject({ url: '/v1/balance', headers: { 'x-api-key': data.apiKey } });
  assert.equal(balance.statusCode, 200); assert.equal(balance.json().availableUSD, '10.000000');
  assert.equal(balance.headers['cache-control'], 'no-store');
  assert.equal(created.headers['cache-control'], 'no-store');
  const topped = await server.inject({ method: 'POST', url: `/api/admin/teams/${teamId}/credits`, headers, payload: { amountUSD: '2.50', note: 'Event bonus' } });
  assert.equal(topped.statusCode, 200); assert.equal(topped.json().balance.creditUSD, '12.500000');
  assert.equal(await db.teamCreditChange.count({ where: { teamId } }), 2);
  const overLimit = await server.inject({ method: 'POST', url: `/api/admin/teams/${teamId}/credits`, headers, payload: { amountUSD: '1000', note: 'Must not commit' } });
  assert.equal(overLimit.statusCode, 400);
  assert.equal(await db.teamCreditChange.count({ where: { teamId } }), 2);
  const metrics = await server.inject({ url: '/api/admin/metrics', headers });
  assert.equal(metrics.statusCode, 200); assert.ok(metrics.json().metrics.totalTeams >= 1);
  assert.ok(Number(metrics.json().metrics.totalCreditUSD) >= 12.5);
  assert.equal((await server.inject({ method: 'DELETE', url: `/api/admin/teams/${teamId}/keys/${stored.id}`, headers })).statusCode, 200);
  assert.equal((await server.inject({ url: '/v1/balance', headers: { 'x-api-key': data.apiKey } })).statusCode, 401);
  const replacement = (await server.inject({ method: 'POST', url: `/api/admin/teams/${teamId}/keys`, headers, payload: { name: 'Replacement' } })).json();
  assert.equal((await server.inject({ method: 'PATCH', url: `/api/admin/teams/${teamId}`, headers, payload: { status: 'DISABLED' } })).statusCode, 200);
  assert.equal((await server.inject({ url: '/v1/balance', headers: { 'x-api-key': replacement.apiKey } })).statusCode, 403);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

test('PostgreSQL serializes concurrent team reservations and settles exactly once', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.match(url.pathname, /_test$/, 'Integration database name must end with _test');
  process.env.DATABASE_URL = url.toString();
  const { db } = await import('../packages/database/src/index');
  const { reserveSession, settleSession, claimSession, cancelSession } = await import('../packages/database/src/quota');
  const team = `integration-${randomUUID()}`;
  const users = await Promise.all(['alice', 'bob'].map(name => db.user.create({ data: {
    name, email: `${name}-${team}@example.com`, password: 'test-not-used-for-login', team, tokenLimit: 1000,
  } })));
  t.after(async () => {
    const ids = users.map(user => user.id);
    await db.tokenUsage.deleteMany({ where: { userId: { in: ids } } });
    await db.agentSession.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  });
  const results = await Promise.allSettled(users.map(user => reserveSession(user.id, { task: 'test', files: [] }, 900)));
  const winners = results.filter(result => result.status === 'fulfilled');
  assert.equal(winners.length, 1);
  const session = (winners[0] as PromiseFulfilledResult<any>).value;
  assert.equal(session.tokensReserved, 1000);
  await claimSession(session.id);
  await Promise.all(Array.from({ length: 5 }, () => settleSession(session.id, 'COMPLETED', { inputTokens: 100, outputTokens: 50, exact: true, model: 'test', requestId: session.id })));
  const current = await db.user.findUniqueOrThrow({ where: { id: session.userId } });
  assert.equal(current.tokensUsed, 150);
  assert.equal(current.tokensReserved, 0);
  assert.equal(await db.tokenUsage.count({ where: { sessionId: session.id } }), 1);
  const remaining = await reserveSession(users.find(user => user.id !== session.userId)!.id, { task: 'test', files: [] }, 800);
  assert.equal(remaining.maxOutputTokens, 50);
  await cancelSession(remaining.id);
  assert.equal(await claimSession(remaining.id), null);
});

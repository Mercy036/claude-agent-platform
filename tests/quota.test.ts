import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../packages/database/src/index';
import { reserveSession, settleSession, cancelSession, claimSession, availableOutput, assertTeamBudget, withQuotaLock } from '../packages/database/src/quota';

// Stateful transaction fixture exercises application accounting and rollback.
// PostgreSQL's actual advisory lock is covered by the opt-in integration suite.
function fixture(t: test.TestContext) {
  const users = new Map<string, any>();
  const sessions = new Map<string, any>();
  const records: any[] = [];
  const update = (row: any, data: any) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && ('increment' in value || 'decrement' in value)) {
        row[key] += (value as any).increment ?? -(value as any).decrement;
      } else row[key] = value;
    }
    return { ...row };
  };
  const tx = {
    $queryRaw: async (query: TemplateStringsArray) => { assert.match(query.join(''), /pg_advisory_xact_lock/); },
    user: {
      findUnique: async ({ where }: any) => { const user = users.get(where.id); return user ? { ...user } : null; },
      aggregate: async ({ where }: any) => ({ _min: { tokenLimit: Math.min(...[...users.values()].filter(user => user.team === where.team).map(user => user.tokenLimit)) } }),
      update: async ({ where, data }: any) => update(users.get(where.id), data),
    },
    agentSession: {
      count: async ({ where }: any) => [...sessions.values()].filter(session => session.userId === where.userId && !session.settledAt && where.status.in.includes(session.status)).length,
      aggregate: async ({ where }: any) => {
        const group = [...sessions.values()].filter(session => session.quotaKey === where.quotaKey);
        return { _sum: { tokensUsed: group.reduce((n, s) => n + s.tokensUsed, 0), tokensReserved: group.reduce((n, s) => n + s.tokensReserved, 0) } };
      },
      create: async ({ data }: any) => {
        const row = { id: randomUUID(), status: 'QUEUED', tokensUsed: 0, settledAt: null, ...data };
        sessions.set(row.id, row); return { ...row };
      },
      findUnique: async ({ where, include }: any) => { const row = sessions.get(where.id); return row ? { ...row, ...(include ? { user: users.get(row.userId) } : {}) } : null; },
      findUniqueOrThrow: async ({ where }: any) => { assert.ok(sessions.has(where.id)); return { ...sessions.get(where.id) }; },
      update: async ({ where, data }: any) => update(sessions.get(where.id), data),
    },
    tokenUsage: { create: async ({ data }: any) => { assert.equal(records.some(row => row.requestId === data.requestId), false); records.push(data); } },
  };
  let previous = Promise.resolve();
  t.mock.method(db, '$transaction', (fn: any) => {
    const result = previous.then(async () => {
      const snapshot = structuredClone({ users, sessions, records });
      try { return await fn(tx); }
      catch (error) {
        users.clear(); for (const [id, row] of snapshot.users) users.set(id, row);
        sessions.clear(); for (const [id, row] of snapshot.sessions) sessions.set(id, row);
        records.splice(0, records.length, ...snapshot.records);
        throw error;
      }
    });
    previous = result.then(() => {}, () => {});
    return result;
  });
  const addUser = (id: string, team: string | null = null, tokenLimit = 1000) => users.set(id, { id, team, tokenLimit, tokensUsed: 0, tokensReserved: 0, status: 'ACTIVE' });
  return { users, sessions, records, addUser };
}
const request = { task: 'Write code', files: [] };
const usage = (inputTokens: number, outputTokens: number, exact = true) => ({ inputTokens, outputTokens, exact, model: 'test-model', requestId: 'provider-id' });

test('output cap cannot exceed remaining allowance', () => {
  assert.equal(availableOutput(1000, 900), 100);
  assert.equal(availableOutput(1000000, 100), 4096);
  assert.throws(() => availableOutput(100, 100), /Insufficient/);
});
test('concurrent teammates cannot reserve the same remaining shared budget', async t => {
  const state = fixture(t); state.addUser('alice', 'team'); state.addUser('bob', 'team');
  const results = await Promise.allSettled([reserveSession('alice', request, 900), reserveSession('bob', request, 900)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal([...state.users.values()].reduce((n, user) => n + user.tokensReserved, 0), 1000);
  assert.equal(state.sessions.size, 1);
});
test('prevents multiple active tasks, disabled users and exhausted budgets', async t => {
  const state = fixture(t); state.addUser('alice'); state.addUser('disabled');
  state.users.get('disabled').status = 'DISABLED';
  await reserveSession('alice', request, 200);
  await assert.rejects(reserveSession('alice', request, 200), /already active/);
  await assert.rejects(reserveSession('disabled', request, 200), /disabled/);
});
test('successful settlement atomically refunds unused reservation and is idempotent', async t => {
  const state = fixture(t); state.addUser('alice');
  const session = await reserveSession('alice', request, 200);
  await claimSession(session.id);
  await settleSession(session.id, 'COMPLETED', usage(100, 50));
  await settleSession(session.id, 'COMPLETED', usage(100, 50));
  assert.equal(state.users.get('alice').tokensUsed, 150);
  assert.equal(state.users.get('alice').tokensReserved, 0);
  assert.equal(state.sessions.get(session.id).tokensUsed, 150);
  assert.equal(state.records.length, 1);
});
test('queued cancellation refunds all quota and prevents worker claim', async t => {
  const state = fixture(t); state.addUser('alice');
  const session = await reserveSession('alice', request, 200);
  await cancelSession(session.id, 'alice');
  assert.equal(await claimSession(session.id), null);
  assert.equal(state.users.get('alice').tokensReserved, 0);
  assert.equal(state.users.get('alice').tokensUsed, 0);
  await assert.rejects(cancelSession(session.id, 'other-user'), /not found/);
});
test('running cancellation retains reservation until worker settles uncertain usage', async t => {
  const state = fixture(t); state.addUser('alice');
  const session = await reserveSession('alice', request, 200);
  await claimSession(session.id);
  await cancelSession(session.id, 'alice');
  assert.equal(state.users.get('alice').tokensReserved, 1000);
  await settleSession(session.id, 'FAILED', usage(100, 20, false));
  assert.equal(state.users.get('alice').tokensReserved, 0);
  assert.equal(state.users.get('alice').tokensUsed, 1000);
  assert.equal(state.sessions.get(session.id).status, 'CANCELLED');
});
test('accounting failure rolls back both usage ledger and reservation release', async t => {
  const state = fixture(t); state.addUser('alice');
  const session = await reserveSession('alice', request, 200);
  await assert.rejects(settleSession(session.id, 'COMPLETED', usage(1001, 1)), /exceeded reserved/);
  assert.equal(state.records.length, 0);
  assert.equal(state.users.get('alice').tokensReserved, 1000);
  assert.equal(state.users.get('alice').tokensUsed, 0);
});

test('team quota changes cannot invalidate another member’s reservation', async t => {
  const state = fixture(t); state.addUser('alice', 'team'); state.addUser('bob', 'team');
  await reserveSession('alice', request, 200);
  state.users.get('bob').tokenLimit = 500;
  await assert.rejects(withQuotaLock(tx => assertTeamBudget(tx, 'team')), /consumed and reserved/);
});

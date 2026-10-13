import { db, Prisma, SessionStatus } from './index';
import type { AgentRequest } from '@claude-hackathon/shared';

export class QuotaError extends Error {
  constructor(message: string, public statusCode = 403) { super(message); }
}

// Serialize short quota mutations across API replicas, team moves and workers.
// READ COMMITTED sees the previous lock holder's writes after acquiring the lock.
export function withQuotaLock<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(20261013)::text`;
    return fn(tx);
  }, { maxWait: 10000, timeout: 15000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export function availableOutput(remaining: number, inputBudget: number): number {
  if (!Number.isSafeInteger(inputBudget) || inputBudget < 1) throw new QuotaError('Invalid token estimate', 400);
  const output = Math.min(4096, remaining - inputBudget);
  if (output < 1) throw new QuotaError('Insufficient remaining token quota for this request');
  return output;
}

export async function reserveSession(userId: string, request: AgentRequest, inputBudget: number) {
  return withQuotaLock(async tx => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE') throw new QuotaError('Account disabled');
    if (await tx.agentSession.count({ where: { userId, settledAt: null, status: { in: ['QUEUED', 'RUNNING', 'CANCELLED'] } } })) {
      throw new QuotaError('An agent task is already active for this account', 409);
    }
    const quotaKey = user.team ? `team:${user.team}` : `user:${user.id}`;
    let remaining = user.tokenLimit - user.tokensUsed - user.tokensReserved;
    if (user.team) {
      const limits = await tx.user.aggregate({ where: { team: user.team }, _min: { tokenLimit: true } });
      const usage = await tx.agentSession.aggregate({ where: { quotaKey }, _sum: { tokensUsed: true, tokensReserved: true } });
      remaining = Math.min(remaining, (limits._min.tokenLimit ?? 0) -
        (usage._sum.tokensUsed ?? 0) - (usage._sum.tokensReserved ?? 0));
    }
    const maxOutputTokens = availableOutput(remaining, inputBudget);
    const tokensReserved = inputBudget + maxOutputTokens;
    await tx.user.update({ where: { id: userId }, data: { tokensReserved: { increment: tokensReserved } } });
    return tx.agentSession.create({ data: {
      userId, quotaKey, request: request as Prisma.InputJsonValue,
      inputTokens: inputBudget, maxOutputTokens, tokensReserved,
    } });
  });
}

export type Usage = { inputTokens: number; outputTokens: number; model: string; requestId: string; exact: boolean };

export async function assertTeamBudget(tx: Prisma.TransactionClient, team: string | null | undefined) {
  if (!team) return;
  const [limits, usage] = await Promise.all([
    tx.user.aggregate({ where: { team }, _min: { tokenLimit: true } }),
    tx.agentSession.aggregate({ where: { quotaKey: `team:${team}` }, _sum: { tokensUsed: true, tokensReserved: true } }),
  ]);
  const committed = (usage._sum.tokensUsed ?? 0) + (usage._sum.tokensReserved ?? 0);
  if (limits._min.tokenLimit !== null && limits._min.tokenLimit < committed) {
    throw new QuotaError('Team token limit cannot be below its consumed and reserved tokens', 409);
  }
}

export async function settleSession(sessionId: string, status: SessionStatus, usage?: Usage) {
  return withQuotaLock(async tx => {
    const session = await tx.agentSession.findUniqueOrThrow({ where: { id: sessionId } });
    if (session.settledAt) return session; // Idempotent on crash recovery / duplicate jobs.
    const charged = usage ? (usage.exact ? usage.inputTokens + usage.outputTokens : session.tokensReserved) : 0;
    if (charged > session.tokensReserved) throw new Error('Provider usage exceeded reserved budget; reservation retained for reconciliation');
    if (usage) await tx.tokenUsage.create({ data: {
      userId: session.userId, sessionId, requestId: sessionId,
      providerRequestId: usage.requestId || null, estimated: !usage.exact,
      inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: charged, model: usage.model,
    } });
    await tx.user.update({ where: { id: session.userId }, data: {
      tokensReserved: { decrement: session.tokensReserved }, tokensUsed: { increment: charged },
    } });
    return tx.agentSession.update({ where: { id: sessionId }, data: {
      status: session.status === 'CANCELLED' ? 'CANCELLED' : status,
      tokensReserved: 0, tokensUsed: charged, settledAt: new Date(), endedAt: new Date(), request: Prisma.DbNull,
    } });
  });
}

export async function cancelSession(sessionId: string, userId?: string) {
  return withQuotaLock(async tx => {
    const session = await tx.agentSession.findUnique({ where: { id: sessionId } });
    if (!session || (userId && session.userId !== userId)) throw new QuotaError('Session not found', 404);
    if (session.settledAt) return session;
    const queued = session.status === 'QUEUED';
    if (queued) await tx.user.update({ where: { id: session.userId }, data: { tokensReserved: { decrement: session.tokensReserved } } });
    return tx.agentSession.update({ where: { id: sessionId }, data: {
      status: 'CANCELLED', ...(queued ? { tokensReserved: 0, settledAt: new Date(), endedAt: new Date(), request: Prisma.DbNull } : {}),
    } });
  });
}

export async function claimSession(sessionId: string) {
  return withQuotaLock(async tx => {
    const session = await tx.agentSession.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!session || session.settledAt || session.status !== 'QUEUED') return null;
    if (session.user.status !== 'ACTIVE') return null;
    return tx.agentSession.update({ where: { id: sessionId }, data: { status: 'RUNNING', startedAt: new Date(), lastActivity: new Date() } });
  });
}

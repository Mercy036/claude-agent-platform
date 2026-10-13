import { createHash, randomBytes } from 'node:crypto';
import { db, Prisma } from './index';

export class GatewayError extends Error {
  constructor(message: string, public statusCode = 400, public type = 'invalid_request_error') { super(message); }
}
export const hashTeamKey = (key: string) => createHash('sha256').update(key).digest('hex');
export function generateTeamKey() {
  const secret = `ht_${randomBytes(8).toString('hex')}_${randomBytes(32).toString('base64url')}`;
  return { secret, keyHash: hashTeamKey(secret), prefix: secret.slice(0, 20) };
}
export function usdToMicros(value: string): number {
  if (!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?$/.test(value)) throw new GatewayError('Use a USD amount with at most six decimal places');
  const [whole, fraction = ''] = value.split('.');
  const micros = Number(whole) * 1000000 + Number(fraction.padEnd(6, '0'));
  if (micros > 1000000000) throw new GatewayError('Team credit cannot exceed $1000');
  return micros;
}
export const microsToUsd = (micros: number) => `${Math.floor(micros / 1000000)}.${String(micros % 1000000).padStart(6, '0')}`;

export function gatewayLock<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(20261014)::text`;
    return fn(tx);
  }, { maxWait: 10000, timeout: 15000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function authenticateTeamKey(secret: string) {
  if (!/^ht_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/.test(secret)) throw new GatewayError('Invalid team API key', 401, 'authentication_error');
  const key = await db.teamApiKey.findUnique({ where: { keyHash: hashTeamKey(secret) }, include: { team: true } });
  if (!key || key.revokedAt) throw new GatewayError('Invalid or revoked team API key', 401, 'authentication_error');
  if (key.team.status !== 'ACTIVE') throw new GatewayError('Team access is disabled', 403, 'permission_error');
  return key;
}

export type GatewayBudget = { model: string; inputBudget: number; maxOutputTokens: number; inputRateMicros: number; outputRateMicros: number; globalConcurrency: number };
export function budgetCost(budget: Pick<GatewayBudget, 'inputBudget' | 'maxOutputTokens' | 'inputRateMicros' | 'outputRateMicros'>) {
  const values = [budget.inputBudget, budget.maxOutputTokens, budget.inputRateMicros, budget.outputRateMicros];
  if (values.some(value => !Number.isSafeInteger(value) || value < 1)) throw new GatewayError('Invalid request budget');
  const cost = budget.inputBudget * budget.inputRateMicros + budget.maxOutputTokens * budget.outputRateMicros;
  if (!Number.isSafeInteger(cost) || cost > 1000000000) throw new GatewayError('Request exceeds the maximum credit allowance');
  return cost;
}

export async function reserveGateway(keyId: string, budget: GatewayBudget) {
  const reservedMicros = budgetCost(budget);
  return gatewayLock(async tx => {
    const key = await tx.teamApiKey.findUnique({ where: { id: keyId }, include: { team: true } });
    if (!key || key.revokedAt) throw new GatewayError('API key revoked', 401, 'authentication_error');
    const team = key.team;
    if (team.status !== 'ACTIVE') throw new GatewayError('Team access disabled', 403, 'permission_error');
    if (team.creditMicros - team.spentMicros - team.reservedMicros < reservedMicros) throw new GatewayError('Insufficient team credit for the requested maximum output', 402, 'credit_exhausted_error');
    const [teamActive, globalActive, recent] = await Promise.all([
      tx.gatewayRequest.count({ where: { teamId: team.id, settledAt: null } }),
      tx.gatewayRequest.count({ where: { settledAt: null } }),
      tx.gatewayRequest.count({ where: { teamId: team.id, createdAt: { gt: new Date(Date.now() - 60000) } } }),
    ]);
    if (teamActive >= team.maxConcurrentRequests || globalActive >= budget.globalConcurrency || recent >= team.requestsPerMinute) throw new GatewayError('Gateway capacity or team rate limit reached; retry later', 429, 'rate_limit_error');
    await tx.team.update({ where: { id: team.id }, data: { reservedMicros: { increment: reservedMicros } } });
    await tx.teamApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    return tx.gatewayRequest.create({ data: {
      teamId: team.id, keyId: key.id, model: budget.model, reservedMicros, inputBudget: budget.inputBudget,
      maxOutputTokens: budget.maxOutputTokens, inputRateMicros: budget.inputRateMicros, outputRateMicros: budget.outputRateMicros,
    } });
  });
}

export type GatewayUsage = { inputTokens: number; outputTokens: number; providerRequestId?: string; exact: boolean };
export async function settleGateway(id: string, status: 'COMPLETED' | 'FAILED' | 'CANCELLED', usage?: GatewayUsage) {
  return gatewayLock(async tx => {
    const request = await tx.gatewayRequest.findUniqueOrThrow({ where: { id } });
    if (request.settledAt) return request;
    const exactCost = usage ? usage.inputTokens * request.inputRateMicros + usage.outputTokens * request.outputRateMicros : 0;
    const withinBudget = Number.isSafeInteger(exactCost) && exactCost >= 0 && exactCost <= request.reservedMicros;
    const estimated = !!usage && (!usage.exact || !withinBudget);
    const chargedMicros = estimated ? request.reservedMicros : exactCost;
    await tx.team.update({ where: { id: request.teamId }, data: {
      reservedMicros: { decrement: request.reservedMicros }, spentMicros: { increment: chargedMicros },
    } });
    return tx.gatewayRequest.update({ where: { id }, data: {
      status: withinBudget ? status : 'FAILED', chargedMicros, estimated, settledAt: new Date(),
      inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0,
      providerRequestId: usage?.providerRequestId ?? null,
    } });
  });
}

export async function recoverGatewayReservations() {
  const abandoned = await db.gatewayRequest.findMany({ where: { settledAt: null, lastActivity: { lt: new Date(Date.now() - 3 * 60 * 1000) } }, take: 500 });
  for (const request of abandoned) {
    await settleGateway(request.id, 'FAILED', request.status === 'RUNNING' ? { inputTokens: 0, outputTokens: 0, exact: false } : undefined);
  }
}

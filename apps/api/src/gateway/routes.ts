import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db, GatewayError, authenticateTeamKey, generateTeamKey, gatewayLock, reserveGateway, settleGateway,
  usdToMicros, microsToUsd, type GatewayUsage, type Prisma } from '@claude-hackathon/database';
import { MessageRequestSchema, CountRequestSchema, gatewayConfig, modelPrice, countPayload, inputBudget, providerUsage, ProviderFrameParser } from './protocol';
import { createProvider, boundedJson, providerError } from './provider';

type KeyIdentity = Prisma.TeamApiKeyGetPayload<{ include: { team: true } }>;
declare module 'fastify' { interface FastifyRequest { gatewayKey: KeyIdentity | null } }
type AdminHook = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
const keySelect = { id: true, name: true, prefix: true, createdAt: true, revokedAt: true, lastUsedAt: true } as const;
const money = z.string().refine(value => { try { usdToMicros(value); return true; } catch { return false; } }, 'Use a USD amount between 0 and 1000 with at most six decimal places');
function balance(team: { creditMicros: number; spentMicros: number; reservedMicros: number }) {
  return { currency: 'USD', creditUSD: microsToUsd(team.creditMicros), spentUSD: microsToUsd(team.spentMicros),
    reservedUSD: microsToUsd(team.reservedMicros), availableUSD: microsToUsd(team.creditMicros - team.spentMicros - team.reservedMicros) };
}
const teamSelect = { id: true, name: true, status: true, creditMicros: true, spentMicros: true, reservedMicros: true,
  maxConcurrentRequests: true, requestsPerMinute: true, createdAt: true } as const;
export const defaultGatewayServices = () => ({
  database: db, lock: gatewayLock, authenticate: authenticateTeamKey, reserve: reserveGateway,
  settle: settleGateway, provider: createProvider(), config: gatewayConfig(),
});

export async function registerGateway(server: FastifyInstance, admin: AdminHook, services = defaultGatewayServices()) {
  const { database, config, provider } = services;
  server.decorateRequest('gatewayKey', null);
  const auth = async (request: FastifyRequest) => {
    const key = request.headers['x-api-key'];
    const bearer = request.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if ((key && typeof key !== 'string') || (key && bearer && key !== bearer) || (!key && !bearer)) throw new GatewayError('Supply a team API key in x-api-key or Authorization: Bearer', 401, 'authentication_error');
    request.gatewayKey = await services.authenticate(String(key || bearer));
    if (request.headers['anthropic-beta']) throw new GatewayError('Beta features are not enabled on this gateway');
    if (request.headers['anthropic-version'] && request.headers['anthropic-version'] !== '2023-06-01') throw new GatewayError('Use anthropic-version: 2023-06-01');
  };

  server.get('/api/admin/teams', { preValidation: admin }, async () => {
    const teams = await database.team.findMany({ select: { ...teamSelect, keys: { select: keySelect } }, orderBy: { createdAt: 'asc' } });
    return { teams: teams.map(team => ({ ...team, balance: balance(team) })), models: config.models };
  });
  server.post('/api/admin/teams', { preValidation: admin }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const values = z.object({ name: z.string().trim().min(1).max(100), creditUSD: money.default('10.00') }).strict().parse(request.body);
    const generated = generateTeamKey();
    const result = await services.lock(async tx => {
      const team = await tx.team.create({ data: { name: values.name, creditMicros: usdToMicros(values.creditUSD) }, select: teamSelect });
      const key = await tx.teamApiKey.create({ data: { teamId: team.id, name: 'Initial team key', keyHash: generated.keyHash, prefix: generated.prefix }, select: keySelect });
      await tx.teamCreditChange.create({ data: { teamId: team.id, amountMicros: team.creditMicros, note: 'Initial allocation', adminId: request.user.id } });
      return { team, key };
    });
    return { ...result, balance: balance(result.team), apiKey: generated.secret };
  });
  server.patch('/api/admin/teams/:id', { preValidation: admin }, async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const values = z.object({ status: z.enum(['ACTIVE', 'DISABLED']).optional(), maxConcurrentRequests: z.number().int().min(1).max(20).optional(), requestsPerMinute: z.number().int().min(1).max(1000).optional() }).strict().parse(request.body);
    const team = await services.lock(tx => tx.team.update({ where: { id }, data: values, select: teamSelect }));
    return { team, balance: balance(team) };
  });
  server.post('/api/admin/teams/:id/credits', { preValidation: admin }, async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { amountUSD, note } = z.object({ amountUSD: money, note: z.string().trim().min(1).max(200) }).strict().parse(request.body);
    const amountMicros = usdToMicros(amountUSD);
    if (!amountMicros) throw new GatewayError('Top-up must be positive');
    const team = await services.lock(async tx => {
      const current = await tx.team.findUniqueOrThrow({ where: { id } });
      if (current.creditMicros + amountMicros > 1000000000) throw new GatewayError('Total allocation cannot exceed $1000');
      const updated = await tx.team.update({ where: { id }, data: { creditMicros: { increment: amountMicros } }, select: teamSelect });
      await tx.teamCreditChange.create({ data: { teamId: id, amountMicros, note, adminId: request.user.id } });
      return updated;
    });
    return { team, balance: balance(team) };
  });
  server.post('/api/admin/teams/:id/keys', { preValidation: admin }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).strict().parse(request.body);
    const generated = generateTeamKey();
    const key = await services.lock(async tx => {
      await tx.team.findUniqueOrThrow({ where: { id } });
      if (await tx.teamApiKey.count({ where: { teamId: id, revokedAt: null } }) >= 10) throw new GatewayError('Revoke an existing key before issuing more than ten active keys');
      return tx.teamApiKey.create({ data: { teamId: id, name, keyHash: generated.keyHash, prefix: generated.prefix }, select: keySelect });
    });
    return { key, apiKey: generated.secret };
  });
  server.delete('/api/admin/teams/:id/keys/:keyId', { preValidation: admin }, async request => {
    const { id, keyId } = z.object({ id: z.string().uuid(), keyId: z.string().uuid() }).parse(request.params);
    await services.lock(async tx => {
      const key = await tx.teamApiKey.findFirst({ where: { id: keyId, teamId: id } });
      if (!key) throw new GatewayError('Key not found', 404, 'not_found_error');
      await tx.teamApiKey.update({ where: { id: keyId }, data: { revokedAt: key.revokedAt || new Date() } });
    });
    return { success: true };
  });
  server.get('/api/admin/teams/:id/usage', { preValidation: admin }, async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await database.team.findUniqueOrThrow({ where: { id } });
    const [requests, creditChanges] = await Promise.all([
      database.gatewayRequest.findMany({ where: { teamId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      database.teamCreditChange.findMany({ where: { teamId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);
    return { requests, creditChanges };
  });

  await server.register(async gateway => {
    gateway.setErrorHandler((error, _request, reply) => {
      if (error instanceof GatewayError) {
        if (error.statusCode === 429) reply.header('retry-after', '5');
        return reply.status(error.statusCode).send({ type: 'error', error: { type: error.type, message: error.message } });
      }
      if (error instanceof z.ZodError || [400, 413, 415].includes(error.statusCode || 0)) return reply.status(error.statusCode || 400).send({ type: 'error', error: { type: 'invalid_request_error', message: 'Invalid request or unsupported feature. Use messages with text/base64 images and custom tools; caching, beta features and paid server tools are disabled.' } });
      server.log.error(error);
      return reply.status(error.statusCode === 429 ? 429 : 502).send({ type: 'error', error: { type: error.statusCode === 429 ? 'rate_limit_error' : 'api_error', message: error.statusCode === 429 ? 'Team rate limit reached' : 'Gateway request failed' } });
    });
    gateway.get('/v1/models', { preValidation: auth }, async () => {
      const data = Object.keys(config.models).map(id => ({ id, type: 'model', display_name: id, created_at: '2025-10-01T00:00:00Z' }));
      return { data, has_more: false, first_id: data[0]?.id, last_id: data.at(-1)?.id };
    });
    gateway.get('/v1/balance', { preValidation: auth }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return { teamId: request.gatewayKey!.teamId, teamName: request.gatewayKey!.team.name, ...balance(request.gatewayKey!.team) };
    });
    gateway.post('/v1/messages/count_tokens', { preValidation: auth }, async request => {
      const values = CountRequestSchema.parse(request.body);
      modelPrice(config.models, values.model);
      if (request.gatewayKey!.team.creditMicros <= request.gatewayKey!.team.spentMicros + request.gatewayKey!.team.reservedMicros) throw new GatewayError('Team credit exhausted', 402, 'credit_exhausted_error');
      return { input_tokens: await provider.count(values, AbortSignal.timeout(30000)) };
    });
    gateway.post('/v1/messages', { preValidation: auth }, async (request, reply) => {
      const body = MessageRequestSchema.parse(request.body);
      const price = modelPrice(config.models, body.model);
      if (body.max_tokens > config.maxOutputTokens) throw new GatewayError(`max_tokens cannot exceed ${config.maxOutputTokens}`);
      const team = request.gatewayKey!.team;
      if (team.creditMicros <= team.spentMicros + team.reservedMicros) throw new GatewayError('Team credit exhausted', 402, 'credit_exhausted_error');
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]);
      const close = () => { if (!reply.raw.writableEnded) controller.abort(); };
      reply.raw.once('close', close);
      let entry: Awaited<ReturnType<typeof reserveGateway>> | undefined;
      let submitted = false;
      let exactUsage: GatewayUsage | undefined;
      let receivedUsage: GatewayUsage = { inputTokens: 0, outputTokens: 0, exact: false };
      let timer: NodeJS.Timeout | undefined;
      let hijacked = false;
      try {
        const payload = countPayload(body);
        const estimated = await provider.count(payload, signal);
        signal.throwIfAborted();
        entry = await services.reserve(request.gatewayKey!.id, {
          model: body.model, inputBudget: inputBudget(payload, estimated), maxOutputTokens: body.max_tokens,
          inputRateMicros: price.inputMicrosPerToken, outputRateMicros: price.outputMicrosPerToken, globalConcurrency: config.globalConcurrency,
        });
        reply.header('x-gateway-request-id', entry.id);
        signal.throwIfAborted();
        await database.gatewayRequest.update({ where: { id: entry.id }, data: { status: 'RUNNING' } });
        let checking = false;
        timer = setInterval(async () => {
          if (checking || !entry) return;
          checking = true;
          try {
            const key = await database.teamApiKey.findUnique({ where: { id: entry.keyId }, include: { team: true } });
            const current = await database.gatewayRequest.findUnique({ where: { id: entry.id } });
            if (!key || key.revokedAt || key.team.status !== 'ACTIVE' || current?.settledAt) controller.abort();
            else await database.gatewayRequest.update({ where: { id: entry.id }, data: { lastActivity: new Date() } });
          } catch { controller.abort(); }
          finally { checking = false; }
        }, 1000);
        submitted = true;
        const upstream = await provider.messages(body, signal);
        receivedUsage.providerRequestId = upstream.headers.get('request-id') || undefined;
        if (receivedUsage.providerRequestId) reply.header('request-id', receivedUsage.providerRequestId);
        if (!upstream.ok) {
          const definitelyRejected = upstream.status >= 400 && upstream.status < 500;
          exactUsage = { ...receivedUsage, exact: definitelyRejected };
          const value = await boundedJson(upstream, 1024 * 1024);
          await services.settle(entry.id, 'FAILED', exactUsage);
          throw providerError(upstream, value);
        }
        if (!body.stream) {
          const value = z.object({ type: z.literal('message'), id: z.string(), content: z.array(z.unknown()), usage: z.unknown() }).passthrough().parse(await boundedJson(upstream));
          exactUsage = { ...providerUsage(value.usage), providerRequestId: receivedUsage.providerRequestId || value.id, exact: true };
          const settled = await services.settle(entry.id, 'COMPLETED', exactUsage);
          if (settled.status !== 'COMPLETED' || settled.estimated) throw new GatewayError('Request accounting requires reconciliation', 502, 'api_error');
          return reply.send(value);
        }
        if (!upstream.headers.get('content-type')?.includes('text/event-stream') || !upstream.body) throw new Error('Provider did not return SSE');
        reply.hijack(); hijacked = true;
        for (const [name, value] of Object.entries(reply.getHeaders())) if (value !== undefined) reply.raw.setHeader(name, value);
        reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
        const write = async (frame: string) => {
          signal.throwIfAborted();
          if (!reply.raw.write(frame)) await new Promise<void>((resolve, reject) => {
            const done = () => { cleanup(); resolve(); };
            const aborted = () => { cleanup(); reject(new Error('Client disconnected')); };
            const cleanup = () => { reply.raw.off('drain', done); signal.removeEventListener('abort', aborted); };
            reply.raw.once('drain', done); signal.addEventListener('abort', aborted, { once: true });
            if (signal.aborted) aborted();
          });
        };
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        const parser = new ProviderFrameParser();
        let started = false;
        let outputReported = false;
        let bytes = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) throw new Error('Provider stream ended before message_stop');
            bytes += value.byteLength;
            if (bytes > 16 * 1024 * 1024) throw new Error('Provider response too large');
            for (const { frame, value: event } of parser.push(decoder.decode(value, { stream: true }))) {
              if (event?.type === 'message_start') {
                if (started) throw new Error('Duplicate provider message_start');
                const message = z.object({ id: z.string(), usage: z.unknown() }).parse(event.message);
                receivedUsage = { ...providerUsage(message.usage), providerRequestId: receivedUsage.providerRequestId || message.id, exact: false };
                started = true;
              } else if (event?.type === 'message_delta') {
                if (!started) throw new Error('Provider usage before message_start');
                const usage = z.object({ output_tokens: z.number().int().min(0).max(1000000000) }).passthrough().parse(event.usage);
                receivedUsage.outputTokens = usage.output_tokens; outputReported = true;
              } else if (event?.type === 'error') throw new Error('Provider reported stream failure');
              else if (event?.type === 'message_stop') {
                if (!started || !outputReported) throw new Error('Incomplete provider usage');
                exactUsage = { ...receivedUsage, exact: true };
                const settled = await services.settle(entry.id, 'COMPLETED', exactUsage);
                if (settled.status !== 'COMPLETED' || settled.estimated) throw new Error('Accounting requires reconciliation');
                await write(frame); // Publish terminal completion only after dollars settle.
                reply.raw.end();
                return;
              }
              await write(frame);
            }
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } catch (error) {
        if (entry) {
          try { await services.settle(entry.id, controller.signal.aborted ? 'CANCELLED' : 'FAILED', exactUsage || (submitted ? receivedUsage : undefined)); }
          catch (settlementError) { server.log.error(settlementError); }
        }
        if (hijacked) {
          if (!reply.raw.destroyed) reply.raw.end(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Stream interrupted; check your team balance before retrying' } })}\n\n`);
          return;
        }
        throw error;
      } finally {
        if (timer) clearInterval(timer);
        reply.raw.off('close', close); controller.abort();
      }
    });
  });
}

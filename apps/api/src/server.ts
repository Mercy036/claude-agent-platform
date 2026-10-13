import fastify, { FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { db, reserveSession, cancelSession, withQuotaLock, assertTeamBudget, QuotaError, GatewayError, microsToUsd } from '@claude-hackathon/database';
import { createQueue, configuredConcurrency } from '@claude-hackathon/queue';
import { estimateInput } from '@claude-hackathon/agent';
import { AgentRequestSchema } from '@claude-hackathon/shared';
import { z } from 'zod';
import { createEventStore, streamKey } from './pubsub';
import { readConfig } from './config';
import { registerGateway, defaultGatewayServices } from './gateway/routes';

type Identity = { id: string; authVersion: number };
declare module '@fastify/jwt' { interface FastifyJWT { payload: Identity; user: Identity } }
const publicUser = { id: true, name: true, email: true, role: true, team: true, tokenLimit: true, tokensUsed: true, tokensReserved: true, status: true } as const;
const quotaLimit = z.number().int().min(0).max(1000000000);
const emailInput = z.string().email().max(254);
const teamName = z.string().trim().max(100).transform(value => value || null);
const passwordInput = z.string().min(8).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes');

export async function buildServer(config = readConfig(), services = {
  database: db, reserve: reserveSession, cancel: cancelSession, lock: withQuotaLock,
  estimate: estimateInput, queue: process.env.ENABLE_CODING_ASSISTANT === 'true' ? createQueue() : null,
  events: process.env.ENABLE_CODING_ASSISTANT === 'true' ? createEventStore() : null,
}) {
  const server = fastify({ logger: true, bodyLimit: 1024 * 1024 });
  const openStreams = new Set<() => Promise<void>>();
  const database = services.database;
  const gatewayServices = { ...defaultGatewayServices(), database };
  await server.register(cors, { origin: config.origins });
  await server.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: '8h' } });
  await server.register(rateLimit, { max: request => request.gatewayKey?.team.requestsPerMinute || 120, timeWindow: '1 minute', hook: 'preHandler',
    keyGenerator: request => request.gatewayKey ? `team:${request.gatewayKey.teamId}` : request.user?.id || request.ip,
  });

  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    try { await request.jwtVerify(); }
    catch { return reply.status(401).send({ error: 'Invalid or expired authentication' }); }
    const user = await database.user.findUnique({ where: { id: request.user.id } });
    if (!user || user.status !== 'ACTIVE' || user.authVersion !== request.user.authVersion) {
      return reply.status(401).send({ error: 'Account disabled or authentication revoked' });
    }
  };
  const admin = async (request: FastifyRequest, reply: FastifyReply) => {
    await authenticate(request, reply);
    if (reply.sent) return;
    const user = await database.user.findUnique({ where: { id: request.user.id } });
    if (user?.role !== 'ADMIN') return reply.status(403).send({ error: 'Forbidden' });
  };
  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof QuotaError) return reply.status(error.statusCode).send({ error: error.message });
    if (error instanceof GatewayError) return reply.status(error.statusCode).send({ error: error.message });
    if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Invalid input', details: error.flatten() });
    if ('code' in error && error.code === 'P2002') return reply.status(409).send({ error: 'Email or username already exists' });
    if ('code' in error && error.code === 'P2025') return reply.status(404).send({ error: 'User not found' });
    server.log.error(error);
    return reply.status(error.statusCode && error.statusCode < 500 ? error.statusCode : 500).send({ error: error.statusCode === 429 ? 'Too many requests' : 'Request failed' });
  });

  server.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: request => {
    const parsed = z.object({ email: emailInput }).safeParse(request.body);
    return `${request.ip}:${parsed.success ? parsed.data.email.toLowerCase() : 'invalid-login'}`;
  } } } }, async request => {
    const { email, password } = z.object({ email: emailInput, password: z.string().min(1).refine(value => Buffer.byteLength(value, 'utf8') <= 72) }).parse(request.body);
    const user = await database.user.findUnique({ where: { email } });
    if (!user || !await bcrypt.compare(password, user.password) || user.status !== 'ACTIVE') throw new QuotaError('Invalid credentials', 401);
    return { token: server.jwt.sign({ id: user.id, authVersion: user.authVersion }), user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  });
  server.get('/api/auth/me', { preValidation: authenticate }, async request => {
    const user = await database.user.findUniqueOrThrow({ where: { id: request.user.id }, select: publicUser });
    let teamQuota = null;
    if (user.team) {
      const [limits, usage] = await Promise.all([
        database.user.aggregate({ where: { team: user.team }, _min: { tokenLimit: true } }),
        database.agentSession.aggregate({ where: { quotaKey: `team:${user.team}` }, _sum: { tokensUsed: true, tokensReserved: true } }),
      ]);
      teamQuota = { tokenLimit: limits._min.tokenLimit, tokensUsed: usage._sum.tokensUsed ?? 0, tokensReserved: usage._sum.tokensReserved ?? 0 };
    }
    return { user, teamQuota };
  });
  server.get('/api/admin/metrics', { preValidation: admin }, async () => {
    const [totalUsers, usage, activeAgents, queuedJobs, totalTeams, credits, gatewayActiveRequests] = await Promise.all([
      database.user.count({ where: { role: 'PARTICIPANT' } }), database.user.aggregate({ _sum: { tokensUsed: true } }),
      database.agentSession.count({ where: { status: 'RUNNING' } }), database.agentSession.count({ where: { status: 'QUEUED' } }),
      database.team.count(), database.team.aggregate({ _sum: { creditMicros: true, spentMicros: true, reservedMicros: true } }),
      database.gatewayRequest.count({ where: { settledAt: null } }),
    ]);
    return { metrics: { totalUsers, totalTokens: usage._sum.tokensUsed ?? 0, activeAgents, queuedJobs, maxConcurrentAgents: configuredConcurrency(),
      totalTeams, gatewayActiveRequests, maxGatewayConcurrency: gatewayServices.config.globalConcurrency,
      totalCreditUSD: microsToUsd(credits._sum.creditMicros ?? 0), totalSpentUSD: microsToUsd(credits._sum.spentMicros ?? 0),
      totalReservedUSD: microsToUsd(credits._sum.reservedMicros ?? 0),
      totalAvailableUSD: microsToUsd((credits._sum.creditMicros ?? 0) - (credits._sum.spentMicros ?? 0) - (credits._sum.reservedMicros ?? 0)),
    } };
  });
  server.get('/api/admin/queue', { preValidation: admin }, async () => {
    const include = { user: { select: { email: true, team: true } } };
    const [activeSessions, queuedSessions] = await Promise.all([
      database.agentSession.findMany({ where: { status: 'RUNNING' }, select: { id: true, startedAt: true, user: include.user } , orderBy: { startedAt: 'desc' }, take: 500 }),
      database.agentSession.findMany({ where: { status: 'QUEUED' }, select: { id: true, createdAt: true, user: include.user }, orderBy: { createdAt: 'asc' }, take: 500 }),
    ]);
    return { queue: { activeSessions, queuedSessions } };
  });
  server.get('/api/admin/users', { preValidation: admin }, async () => ({ users: await database.user.findMany({ select: publicUser, orderBy: { createdAt: 'asc' } }) }));
  server.post('/api/admin/users', { preValidation: admin }, async request => {
    const values = z.object({ name: z.string().trim().min(1).max(100), email: emailInput, password: passwordInput, team: teamName.optional(), tokenLimit: quotaLimit.default(1000000) }).parse(request.body);
    const password = await bcrypt.hash(values.password, 12);
    const user = await services.lock(async tx => {
      const created = await tx.user.create({ data: { ...values, password, role: 'PARTICIPANT' }, select: publicUser });
      await assertTeamBudget(tx, created.team);
      return created;
    });
    return { user };
  });
  server.patch('/api/admin/users/:id', { preValidation: admin }, async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const values = z.object({ team: teamName.optional(), password: passwordInput.optional(), tokenLimit: quotaLimit.optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional() }).strict().parse(request.body);
    const password = values.password ? await bcrypt.hash(values.password, 12) : undefined;
    await services.lock(async tx => {
      const user = await tx.user.findUniqueOrThrow({ where: { id } });
      if ((values.team !== undefined || values.tokenLimit !== undefined) && user.tokensReserved > 0) throw new QuotaError('Cancel the active task before changing team or quota', 409);
      if (values.tokenLimit !== undefined && values.tokenLimit < user.tokensUsed) throw new QuotaError('Token limit cannot be below consumed tokens', 400);
      await tx.user.update({ where: { id }, data: { ...values, password,
        ...((password || values.status) ? { authVersion: { increment: 1 } } : {}),
      } });
      await assertTeamBudget(tx, user.team);
      if (values.team !== undefined) await assertTeamBudget(tx, values.team);
    });
    return { success: true };
  });

  server.post('/api/agent/run', { preValidation: authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const queue = services.queue;
    const events = services.events;
    if (!queue || !events) throw new QuotaError('Coding assistant is disabled. Use the team gateway at /v1/messages.', 503);
    const values = AgentRequestSchema.parse(request.body);
    for (const file of values.files) if (createHash('sha256').update(file.content).digest('hex') !== file.sha256) throw new QuotaError('Invalid project file checksum', 400);
    const inputBudget = await services.estimate(values);
    const session = await services.reserve(request.user.id, values, inputBudget);
    let terminal = false;
    let disconnected = false;
    const cancel = async () => {
      try { await services.cancel(session.id, request.user.id); }
      catch (error) { server.log.error(error); }
    };
    try {
      await events.publish(session.id)('QUEUED', { sessionId: session.id });
      await queue.queue.add('agent-task', { sessionId: session.id }, {
        jobId: session.id, attempts: 1, removeOnComplete: { age: 3600, count: 1000 }, removeOnFail: { age: 86400, count: 1000 },
      });
    } catch (error) { await cancel(); throw error; }
    reply.hijack();
    for (const [name, value] of Object.entries(reply.getHeaders())) if (value !== undefined) reply.raw.setHeader(name, value);
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const close = async () => { await cancel(); reply.raw.end(); disconnected = true; };
    openStreams.add(close);
    reply.raw.on('close', () => { disconnected = true; if (!terminal) void cancel(); });
    const write = async (data: string) => {
      if (disconnected) return;
      if (!reply.raw.write(data)) await new Promise<void>(resolve => {
        const timeout = setTimeout(() => { reply.raw.destroy(); done(); }, 30000);
        const done = () => { clearTimeout(timeout); reply.raw.off('drain', done); reply.raw.off('close', done); resolve(); };
        reply.raw.once('drain', done); reply.raw.once('close', done);
      });
    };
    let cursor = '0-0';
    let lastCheck = Date.now();
    const deadline = Date.now() + 60 * 60 * 1000;
    try {
      while (!disconnected && !terminal) {
        const entries = await events.connection.xrange(streamKey(session.id), `(${cursor}`, '+', 'COUNT', 100);
        for (const [id, fields] of entries) {
          cursor = id;
          const message = fields[fields.indexOf('message') + 1];
          const parsed = JSON.parse(message);
          terminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(parsed.event);
          await write(`id: ${id}\ndata: ${message}\n\n`);
          if (terminal || disconnected) break;
        }
        if (Date.now() - lastCheck > 5000) {
          lastCheck = Date.now();
          const current = await database.agentSession.findUnique({ where: { id: session.id } });
          if (!current || current.settledAt || Date.now() > deadline) {
            // Never report success without the worker's durable terminal event.
            // Re-read next iteration before failing: the worker may be publishing.
            const pending = await events.connection.xrange(streamKey(session.id), `(${cursor}`, '+', 'COUNT', 1);
            if (!pending.length) {
              terminal = true;
              await write(`data: ${JSON.stringify({ event: 'FAILED', data: { error: 'Stream ended without a complete result' } })}\n\n`);
              await cancel();
            }
          } else await write(': keepalive\n\n');
        }
        if (!terminal && !disconnected) await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error) {
      server.log.error(error);
      await write(`data: ${JSON.stringify({ event: 'FAILED', data: { error: 'Stream connection failed' } })}\n\n`);
      await cancel();
    } finally { openStreams.delete(close); reply.raw.end(); }
  });
  server.post('/api/agent/session', { preValidation: authenticate }, async (_request, reply) => reply.status(410).send({ error: 'Use POST /api/agent/run' }));
  server.post('/api/agent/sessions/:id/cancel', { preValidation: authenticate }, async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await services.cancel(id, request.user.id);
    return { success: true };
  });
  server.addHook('onClose', async () => {
    if (services.queue) { await services.queue.queue.close(); await services.queue.connection.quit(); }
    if (services.events) await services.events.connection.quit();
  });
  server.addHook('preClose', async () => { await Promise.all([...openStreams].map(close => close())); });
  await registerGateway(server, admin, gatewayServices);
  return server;
}

import fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import bcrypt from 'bcrypt';
import { db } from '@claude-hackathon/database';
import { agentQueue } from '@claude-hackathon/queue';
import { z } from 'zod';
import { startQueueProcessor } from './queueProcessor';
import { redisSubscriber } from './pubsub';
import { PassThrough } from 'stream';

const server = fastify({ logger: true });

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-hackathon-key';

server.register(cors, { origin: '*' });
server.register(jwt, { secret: JWT_SECRET });

server.decorate('authenticate', async function (request: any, reply: any) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.send(err);
  }
});

// Auth Routes...
server.post('/api/auth/login', async (request, reply) => {
  const schema = z.object({ email: z.string().email(), password: z.string() });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid input' });

  const { email, password } = parsed.data;
  const user = await db.user.findUnique({ where: { email } });
  
  const isValid = user && (user.password === password || await bcrypt.compare(password, user.password));
  if (!user || !isValid) return reply.status(401).send({ error: 'Invalid credentials' });
  if (user.status !== 'ACTIVE') return reply.status(403).send({ error: 'Account disabled' });

  const token = server.jwt.sign({ id: user.id, email: user.email, role: user.role, team: user.team });
  return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
});

server.get('/api/auth/me', { preValidation: [(server as any).authenticate] }, async (request: any, reply) => {
  const user = await db.user.findUnique({ 
    where: { id: request.user.id },
    select: { id: true, name: true, email: true, role: true, team: true, tokenLimit: true, tokensUsed: true, status: true }
  });
  return { user };
});

// Admin Routes
server.get('/api/admin/metrics', { preValidation: [(server as any).authenticate] }, async (request: any, reply) => {
  if (request.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Forbidden' });
  
  const totalUsers = await db.user.count({ where: { role: 'PARTICIPANT' } });
  
  // Aggregate total tokens burned across all users
  const users = await db.user.findMany({ select: { tokensUsed: true } });
  const totalTokens = users.reduce((acc, user) => acc + user.tokensUsed, 0);

  const activeAgents = await db.agentSession.count({ where: { status: 'RUNNING' } });
  const queuedJobs = await db.agentSession.count({ where: { status: 'QUEUED' } });

  return { metrics: { totalUsers, totalTokens, activeAgents, queuedJobs } };
});

server.get('/api/admin/queue', { preValidation: [(server as any).authenticate] }, async (request: any, reply) => {
  if (request.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Forbidden' });

  const activeSessions = await db.agentSession.findMany({
    where: { status: 'RUNNING' },
    include: { user: { select: { email: true, team: true } } },
    orderBy: { startedAt: 'desc' }
  });

  const queuedSessions = await db.agentSession.findMany({
    where: { status: 'QUEUED' },
    include: { user: { select: { email: true, team: true } } },
    orderBy: { createdAt: 'asc' }
  });

  return { queue: { activeSessions, queuedSessions } };
});
server.post('/api/admin/users', { preValidation: [(server as any).authenticate] }, async (request: any, reply) => {
  if (request.user.role !== 'ADMIN') {
    return reply.status(403).send({ error: 'Forbidden' });
  }

  const schema = z.object({
    name: z.string(),
    email: z.string().email(),
    password: z.string().min(6),
    team: z.string().optional(),
    tokenLimit: z.number().optional()
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error });
  }

  const { name, email, password, team, tokenLimit } = parsed.data;
  
  const existingUser = await db.user.findUnique({ where: { email } });
  if (existingUser) {
    return reply.status(400).send({ error: 'Email already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const newUser = await db.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      team,
      tokenLimit: tokenLimit ?? 1000000,
      role: 'PARTICIPANT'
    }
  });

  return { user: { id: newUser.id, email: newUser.email } };
});

server.get('/api/admin/users', { preValidation: [(server as any).authenticate] }, async (request: any, reply) => {
  if (request.user.role !== 'ADMIN') {
    return reply.status(403).send({ error: 'Forbidden' });
  }
  const users = await db.user.findMany({
    select: { id: true, name: true, email: true, role: true, team: true, status: true, tokenLimit: true, tokensUsed: true }
  });
  return { users };
});

server.patch('/api/admin/users/:id', { preValidation: [(server as any).authenticate] }, async (request: any, reply) => {
  if (request.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Forbidden' });
  
  const { id } = request.params;
  const schema = z.object({
    team: z.string().optional(),
    password: z.string().min(6).optional(),
    tokenLimit: z.number().optional()
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: parsed.error });

  const updateData: any = {};
  if (parsed.data.team !== undefined) updateData.team = parsed.data.team;
  if (parsed.data.tokenLimit !== undefined) updateData.tokenLimit = parsed.data.tokenLimit;
  if (parsed.data.password) {
    updateData.password = await bcrypt.hash(parsed.data.password, 10);
  }

  await db.user.update({
    where: { id },
    data: updateData
  });

  return { success: true };
});

// Agent Routes
server.post('/api/agent/session', { preValidation: [(server as any).authenticate] }, async (request: any, reply) => {
  const schema = z.object({ task: z.string(), cwd: z.string() });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid input' });

  const user = await db.user.findUnique({ where: { id: request.user.id } });
  if (!user || user.tokensUsed >= user.tokenLimit) {
    return reply.status(403).send({ error: 'Quota exhausted' });
  }

  const session = await db.agentSession.create({
    data: { userId: user.id, status: 'QUEUED' }
  });
  
  await agentQueue.add('agent-task', {
    sessionId: session.id,
    userId: user.id,
    task: parsed.data.task,
    cwd: parsed.data.cwd
  });

  return { sessionId: session.id };
});

server.get('/api/agent/stream/:sessionId', { preValidation: [(server as any).authenticate] }, async (request: any, reply) => {
  const { sessionId } = request.params;
  
  // Verify ownership
  const session = await db.agentSession.findUnique({ where: { id: sessionId } });
  if (!session || (session.userId !== request.user.id && request.user.role !== 'ADMIN')) {
    return reply.status(403).send({ error: 'Forbidden' });
  }

  const stream = new PassThrough();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const channel = `session:${sessionId}`;
  
  const messageHandler = (ch: string, message: string) => {
    if (ch === channel) {
      reply.raw.write(`data: ${message}\n\n`);
      const { event } = JSON.parse(message);
      if (event === 'COMPLETED' || event === 'FAILED' || event === 'CANCELLED') {
        reply.raw.end();
      }
    }
  };

  redisSubscriber.subscribe(channel);
  redisSubscriber.on('message', messageHandler);

  request.raw.on('close', () => {
    redisSubscriber.unsubscribe(channel);
    redisSubscriber.removeListener('message', messageHandler);
  });

  // Keep connection alive
  const interval = setInterval(() => {
    reply.raw.write(': keepalive\n\n');
  }, 15000);
  
  request.raw.on('close', () => clearInterval(interval));

  return reply.send(stream);
});

const start = async () => {
  try {
    startQueueProcessor();
    await server.listen({ port: 3001, host: '0.0.0.0' });
    console.log(`Server listening on port 3001`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();

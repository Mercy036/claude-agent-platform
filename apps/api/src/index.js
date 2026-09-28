"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const jwt_1 = __importDefault(require("@fastify/jwt"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const database_1 = require("@claude-hackathon/database");
const queue_1 = require("@claude-hackathon/queue");
const zod_1 = require("zod");
const queueProcessor_1 = require("./queueProcessor");
const pubsub_1 = require("./pubsub");
const stream_1 = require("stream");
const server = (0, fastify_1.default)({ logger: true });
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-hackathon-key';
server.register(cors_1.default, { origin: '*' });
server.register(jwt_1.default, { secret: JWT_SECRET });
server.decorate('authenticate', async function (request, reply) {
    try {
        await request.jwtVerify();
    }
    catch (err) {
        reply.send(err);
    }
});
// Auth Routes...
server.post('/api/auth/login', async (request, reply) => {
    const schema = zod_1.z.object({ email: zod_1.z.string().email(), password: zod_1.z.string() });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid input' });
    const { email, password } = parsed.data;
    const user = await database_1.db.user.findUnique({ where: { email } });
    const isValid = user && (user.password === password || await bcrypt_1.default.compare(password, user.password));
    if (!user || !isValid)
        return reply.status(401).send({ error: 'Invalid credentials' });
    if (user.status !== 'ACTIVE')
        return reply.status(403).send({ error: 'Account disabled' });
    const token = server.jwt.sign({ id: user.id, email: user.email, role: user.role, team: user.team });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
});
server.get('/api/auth/me', { preValidation: [server.authenticate] }, async (request, reply) => {
    const user = await database_1.db.user.findUnique({
        where: { id: request.user.id },
        select: { id: true, name: true, email: true, role: true, team: true, tokenLimit: true, tokensUsed: true, status: true }
    });
    return { user };
});
// Admin Routes
server.post('/api/admin/users', { preValidation: [server.authenticate] }, async (request, reply) => {
    if (request.user.role !== 'ADMIN') {
        return reply.status(403).send({ error: 'Forbidden' });
    }
    const schema = zod_1.z.object({
        name: zod_1.z.string(),
        email: zod_1.z.string().email(),
        password: zod_1.z.string().min(6),
        team: zod_1.z.string().optional(),
        tokenLimit: zod_1.z.number().optional()
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error });
    }
    const { name, email, password, team, tokenLimit } = parsed.data;
    const existingUser = await database_1.db.user.findUnique({ where: { email } });
    if (existingUser) {
        return reply.status(400).send({ error: 'Email already exists' });
    }
    const hashedPassword = await bcrypt_1.default.hash(password, 10);
    const newUser = await database_1.db.user.create({
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
server.get('/api/admin/users', { preValidation: [server.authenticate] }, async (request, reply) => {
    if (request.user.role !== 'ADMIN') {
        return reply.status(403).send({ error: 'Forbidden' });
    }
    const users = await database_1.db.user.findMany({
        select: { id: true, name: true, email: true, role: true, team: true, status: true, tokenLimit: true, tokensUsed: true }
    });
    return { users };
});
// Agent Routes
server.post('/api/agent/session', { preValidation: [server.authenticate] }, async (request, reply) => {
    const schema = zod_1.z.object({ task: zod_1.z.string(), cwd: zod_1.z.string() });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid input' });
    const user = await database_1.db.user.findUnique({ where: { id: request.user.id } });
    if (!user || user.tokensUsed >= user.tokenLimit) {
        return reply.status(403).send({ error: 'Quota exhausted' });
    }
    const session = await database_1.db.agentSession.create({
        data: { userId: user.id, status: 'QUEUED' }
    });
    await queue_1.agentQueue.add('agent-task', {
        sessionId: session.id,
        userId: user.id,
        task: parsed.data.task,
        cwd: parsed.data.cwd
    });
    return { sessionId: session.id };
});
server.get('/api/agent/stream/:sessionId', { preValidation: [server.authenticate] }, async (request, reply) => {
    const { sessionId } = request.params;
    // Verify ownership
    const session = await database_1.db.agentSession.findUnique({ where: { id: sessionId } });
    if (!session || (session.userId !== request.user.id && request.user.role !== 'ADMIN')) {
        return reply.status(403).send({ error: 'Forbidden' });
    }
    const stream = new stream_1.PassThrough();
    reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });
    const channel = `session:${sessionId}`;
    const messageHandler = (ch, message) => {
        if (ch === channel) {
            reply.raw.write(`data: ${message}\n\n`);
            const { event } = JSON.parse(message);
            if (event === 'COMPLETED' || event === 'FAILED' || event === 'CANCELLED') {
                reply.raw.end();
            }
        }
    };
    pubsub_1.redisSubscriber.subscribe(channel);
    pubsub_1.redisSubscriber.on('message', messageHandler);
    request.raw.on('close', () => {
        pubsub_1.redisSubscriber.unsubscribe(channel);
        pubsub_1.redisSubscriber.removeListener('message', messageHandler);
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
        (0, queueProcessor_1.startQueueProcessor)();
        await server.listen({ port: 3001, host: '0.0.0.0' });
        console.log(`Server listening on port 3001`);
    }
    catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};
start();
//# sourceMappingURL=index.js.map
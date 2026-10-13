import test from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { generateTeamKey, hashTeamKey, usdToMicros, microsToUsd, budgetCost } from '../packages/database/src/gateway';
import { GatewayError } from '@claude-hackathon/database';
import { registerGateway } from '../apps/api/src/gateway/routes';
import { gatewayConfig, MessageRequestSchema, ProviderFrameParser, inputBudget, providerUsage } from '../apps/api/src/gateway/protocol';

const model = 'claude-haiku-4-5';
const request = { model, max_tokens: 1024, messages: [{ role: 'user', content: 'Call my custom tool' }], tools: [{ name: 'weather', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }] };
const message = { id: 'msg_test', type: 'message', role: 'assistant', model, content: [{ type: 'tool_use', id: 'tool_1', name: 'weather', input: { city: 'Delhi' } }], stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 25 } };
function event(value: unknown) { return `event: ${(value as any).type}\ndata: ${JSON.stringify(value)}\n\n`; }
const stream = () => [
  event({ type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 100, output_tokens: 0 } } }),
  event({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool_1', name: 'weather', input: {} } }),
  event({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"city":"Delhi"}' } }),
  event({ type: 'content_block_stop', index: 0 }),
  event({ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 25 } }),
  event({ type: 'message_stop' }),
].join('');

async function fixture(t: test.TestContext) {
  const generated = generateTeamKey();
  const team = { id: '00000000-0000-4000-8000-000000000001', name: 'Team A', status: 'ACTIVE', creditMicros: 10000000, spentMicros: 0, reservedMicros: 0, maxConcurrentRequests: 2, requestsPerMinute: 60 };
  const key = { id: '00000000-0000-4000-8000-000000000002', teamId: team.id, team, revokedAt: null, name: 'Agent', ...generated };
  const calls: string[] = [];
  const settlements: any[] = [];
  const entry = { id: '00000000-0000-4000-8000-000000000003', keyId: key.id, teamId: team.id, settledAt: null };
  const services: any = {
    config: gatewayConfig(),
    authenticate: async (secret: string) => { if (secret !== generated.secret || key.revokedAt) throw new GatewayError('Invalid key', 401, 'authentication_error'); if (team.status !== 'ACTIVE') throw new GatewayError('Disabled', 403, 'permission_error'); return key; },
    reserve: async (_keyId: string, budget: any) => { calls.push('reserve'); return { ...entry, reservedMicros: budgetCost(budget) }; },
    settle: async (_id: string, status: string, usage: any) => { calls.push('settle'); settlements.push({ status, usage }); return { status, estimated: false }; },
    lock: async (fn: any) => fn(services.database),
    provider: {
      count: async () => { calls.push('count'); return 100; },
      messages: async (body: any) => { calls.push('provider'); return new Response(body.stream ? stream() : JSON.stringify(message), { headers: { 'Content-Type': body.stream ? 'text/event-stream' : 'application/json', 'request-id': 'req_provider' } }); },
    },
    database: {
      gatewayRequest: { update: async () => { calls.push('running'); return entry; }, findUnique: async () => entry },
      teamApiKey: { findUnique: async () => key },
    },
  };
  const server = fastify();
  server.decorateRequest('user', null);
  await registerGateway(server, async (_request, reply) => reply.status(401).send({ error: 'Admin required' }), services);
  t.after(() => server.close());
  return { server, services, team, key, calls, settlements, secret: generated.secret };
}
test('money and API key generation use exact integer accounting and hashed secrets', () => {
  assert.equal(usdToMicros('10.00'), 10000000);
  assert.equal(usdToMicros('0.000001'), 1);
  assert.equal(microsToUsd(10000001), '10.000001');
  for (const invalid of ['-1', '1e2', '1.0000001', '1000.000001', 'NaN']) assert.throws(() => usdToMicros(invalid));
  const first = generateTeamKey(); const second = generateTeamKey();
  assert.notEqual(first.secret, second.secret);
  assert.equal(hashTeamKey(first.secret), first.keyHash);
  assert.equal(first.keyHash.includes(first.secret), false);
  assert.equal(budgetCost({ inputBudget: 100, maxOutputTokens: 25, inputRateMicros: 1, outputRateMicros: 5 }), 225);
});
test('uncosted features are rejected while custom tool conversations are accepted', () => {
  assert.equal(MessageRequestSchema.safeParse(request).success, true);
  assert.equal(MessageRequestSchema.safeParse({ ...request, tools: [{ type: 'web_search_20250305', name: 'web_search' }] }).success, false);
  assert.equal(MessageRequestSchema.safeParse({ ...request, system: [{ type: 'text', text: 'system', cache_control: { type: 'ephemeral' } }] }).success, false);
  assert.equal(MessageRequestSchema.safeParse({ ...request, thinking: { type: 'enabled', budget_tokens: 1024 } }).success, false);
  assert.throws(() => providerUsage({ input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1 }), /cached usage/);
  assert.ok(inputBudget({ model, messages: [{ role: 'user', content: 'hello' }] }, 1) > 4000);
});
test('team authentication, disabled teams and unsupported models fail before spending', async t => {
  const { server, team, calls, secret } = await fixture(t);
  assert.equal((await server.inject({ method: 'POST', url: '/v1/messages', payload: request })).statusCode, 401);
  assert.equal((await server.inject({ method: 'POST', url: '/v1/messages', headers: { 'x-api-key': secret }, payload: { ...request, model: 'unpriced-model' } })).statusCode, 400);
  team.status = 'DISABLED';
  assert.equal((await server.inject({ method: 'POST', url: '/v1/messages', headers: { 'x-api-key': secret }, payload: request })).statusCode, 403);
  assert.deepEqual(calls, []);
});
test('nonstream tool-use responses are unchanged and spending settles before success', async t => {
  const { server, secret, calls, settlements } = await fixture(t);
  const response = await server.inject({ method: 'POST', url: '/v1/messages', headers: { 'x-api-key': secret }, payload: request });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), message);
  assert.deepEqual(calls, ['count', 'reserve', 'running', 'provider', 'settle']);
  assert.equal(settlements[0].usage.inputTokens, 100); assert.equal(settlements[0].usage.outputTokens, 25);
  assert.equal(settlements[0].usage.exact, true);
  assert.equal(response.headers['request-id'], 'req_provider');
});
test('official Anthropic SDK works with the gateway URL and team key for streaming tools', async t => {
  const { server, secret, settlements } = await fixture(t);
  const origin = await server.listen({ host: '127.0.0.1', port: 0 });
  const client = new Anthropic({ apiKey: secret, baseURL: origin, maxRetries: 0 });
  const events = [];
  for await (const item of await client.messages.create({ ...request as any, stream: true })) events.push(item);
  assert.equal(events.at(-1)?.type, 'message_stop');
  assert.ok(events.some(item => item.type === 'content_block_delta' && (item.delta as any).type === 'input_json_delta'));
  assert.equal(settlements[0].status, 'COMPLETED'); assert.equal(settlements[0].usage.outputTokens, 25);
});
test('truncated streams emit an Anthropic error and conservatively settle partial usage', async t => {
  const { server, secret, services, settlements } = await fixture(t);
  services.provider.messages = async () => new Response(stream().replace(event({ type: 'message_stop' }), ''), { headers: { 'Content-Type': 'text/event-stream' } });
  const response = await server.inject({ method: 'POST', url: '/v1/messages', headers: { 'x-api-key': secret }, payload: { ...request, stream: true } });
  assert.equal(response.body.includes('event: error'), true);
  assert.equal(response.body.includes('event: message_stop'), false);
  assert.equal(settlements[0].status, 'FAILED'); assert.equal(settlements[0].usage.exact, false);
});
test('insufficient credit never sends a model-generation request', async t => {
  const { server, secret, services, calls } = await fixture(t);
  services.reserve = async () => { throw new GatewayError('Insufficient team credit', 402, 'credit_exhausted_error'); };
  const response = await server.inject({ method: 'POST', url: '/v1/messages', headers: { 'x-api-key': secret }, payload: request });
  assert.equal(response.statusCode, 402); assert.equal(response.json().error.type, 'credit_exhausted_error');
  assert.deepEqual(calls, ['count']);
});

test('exhausted teams are rejected before even counting tokens upstream', async t => {
  const { server, secret, team, calls } = await fixture(t);
  team.spentMicros = team.creditMicros;
  const response = await server.inject({ method: 'POST', url: '/v1/messages', headers: { 'x-api-key': secret }, payload: request });
  assert.equal(response.statusCode, 402); assert.deepEqual(calls, []);
});
test('provider rejection refunds quota and beta/key conflicts reject immediately', async t => {
  const { server, secret, services, settlements } = await fixture(t);
  services.provider.messages = async () => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Invalid tool' } }), { status: 400 });
  assert.equal((await server.inject({ method: 'POST', url: '/v1/messages', headers: { 'x-api-key': secret }, payload: request })).statusCode, 400);
  assert.equal(settlements[0].usage.exact, true); assert.equal(settlements[0].usage.inputTokens, 0);
  assert.equal((await server.inject({ method: 'POST', url: '/v1/messages', headers: { 'x-api-key': secret, 'anthropic-beta': 'experimental' }, payload: request })).statusCode, 400);
  assert.equal((await server.inject({ method: 'POST', url: '/v1/messages', headers: { 'x-api-key': secret, authorization: 'Bearer other-key' }, payload: request })).statusCode, 401);
});
test('provider parser preserves exact frames across CRLF and chunk boundaries', () => {
  const parser = new ProviderFrameParser();
  assert.deepEqual(parser.push('event: ping\r\nda'), []);
  const frames = parser.push('ta: {"type":"ping"}\r\n\r\n');
  assert.deepEqual(frames[0].value, { type: 'ping' });
  assert.equal(frames[0].frame, 'event: ping\r\ndata: {"type":"ping"}\r\n\r\n');
});

test('malformed JSON is a client error and uncosted requests are never forwarded', async t => {
  const { server, secret, calls } = await fixture(t);
  const malformed = await server.inject({ method: 'POST', url: '/v1/messages', headers: { 'x-api-key': secret, 'content-type': 'application/json' }, payload: '{broken' });
  assert.equal(malformed.statusCode, 400); assert.equal(malformed.json().error.type, 'invalid_request_error');
  const unsupported = await server.inject({ method: 'POST', url: '/v1/messages', headers: { 'x-api-key': secret }, payload: { ...request, tools: [{ type: 'web_search_20250305', name: 'web_search' }] } });
  assert.equal(unsupported.statusCode, 400); assert.deepEqual(calls, []);
});

function waitingProviderBody(signal: AbortSignal) {
  let abort: () => void;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(event({ type: 'message_start', message: { ...message, content: [], usage: { input_tokens: 100, output_tokens: 0 } } })));
      abort = () => controller.error(new Error('Provider aborted'));
      signal.addEventListener('abort', abort, { once: true });
    },
    cancel() { signal.removeEventListener('abort', abort); },
  });
}
test('disconnect aborts the provider and settles potentially billed usage', { timeout: 5000 }, async t => {
  const { server, secret, services, settlements } = await fixture(t);
  let resolveSettled: () => void;
  const settled = new Promise<void>(resolve => { resolveSettled = resolve; });
  const originalSettle = services.settle;
  services.settle = async (...args: any[]) => { const result = await originalSettle(...args); resolveSettled(); return result; };
  services.provider.messages = async (_body: unknown, signal: AbortSignal) => new Response(waitingProviderBody(signal), { headers: { 'Content-Type': 'text/event-stream' } });
  const origin = await server.listen({ host: '127.0.0.1', port: 0 });
  const response = await fetch(`${origin}/v1/messages`, { method: 'POST', headers: { 'x-api-key': secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request, stream: true }) });
  const reader = response.body!.getReader(); await reader.read(); await reader.cancel();
  await settled;
  assert.equal(settlements[0].status, 'CANCELLED'); assert.equal(settlements[0].usage.exact, false); assert.equal(settlements[0].usage.inputTokens, 100);
});
test('revoking a key stops an active provider stream across the polling boundary', { timeout: 5000 }, async t => {
  const { server, secret, key, services, settlements } = await fixture(t);
  let resolveSettled: () => void;
  const settled = new Promise<void>(resolve => { resolveSettled = resolve; });
  const originalSettle = services.settle;
  services.settle = async (...args: any[]) => { const result = await originalSettle(...args); resolveSettled(); return result; };
  services.provider.messages = async (_body: unknown, signal: AbortSignal) => new Response(waitingProviderBody(signal), { headers: { 'Content-Type': 'text/event-stream' } });
  const origin = await server.listen({ host: '127.0.0.1', port: 0 });
  const response = await fetch(`${origin}/v1/messages`, { method: 'POST', headers: { 'x-api-key': secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request, stream: true }) });
  const reader = response.body!.getReader(); await reader.read();
  key.revokedAt = new Date() as any;
  await settled; await reader.cancel();
  assert.equal(settlements[0].status, 'CANCELLED'); assert.equal(settlements[0].usage.exact, false);
});

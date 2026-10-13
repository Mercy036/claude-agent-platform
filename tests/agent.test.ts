import test from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { runAgent, AgentFailure, buildPrompt, estimateInput } from '../packages/agent/src/index';

process.env.ANTHROPIC_API_KEY = 'test-key-never-sent';
const request = { task: 'Edit file', files: [{ path: 'a.ts', content: 'existing code', sha256: 'a'.repeat(64) }] };
function mockStream(t: test.TestContext, stopReason = 'end_turn', fail = false) {
  let options: any;
  let parameters: any;
  t.mock.method(Anthropic.Messages.prototype, 'stream', (params: any, opts: any) => {
    parameters = params; options = opts;
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'message_start', message: { id: 'provider-id', usage: { input_tokens: 100, output_tokens: 0 } } };
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } };
        if (fail) throw new Error('connection dropped');
        yield { type: 'message_delta', usage: { output_tokens: 5 } };
      },
      finalMessage: async () => ({ id: 'provider-id', usage: { input_tokens: 100, output_tokens: 5 }, stop_reason: stopReason }),
    };
  });
  return () => ({ options, parameters });
}
test('provider receives selected project context and the reserved output cap', async t => {
  const captured = mockStream(t);
  const events: string[] = [];
  const usage = await runAgent(request, 500, async event => { events.push(event); }, new AbortController().signal);
  assert.equal(captured().parameters.max_tokens, 500);
  assert.equal(JSON.parse(captured().parameters.messages[0].content).projectFiles[0].content, 'existing code');
  assert.equal(usage.inputTokens + usage.outputTokens, 105);
  assert.equal(usage.exact, true);
  assert.deepEqual(events, ['LOG', 'DELTA']);
  assert.equal(captured().options.signal.aborted, true);
  assert.equal(buildPrompt(request).includes('sha256'), false);
});
test('token-limit truncation fails while retaining exact billed usage', async t => {
  mockStream(t, 'max_tokens');
  await assert.rejects(runAgent(request, 5, async () => {}, new AbortController().signal), error => {
    assert.ok(error instanceof AgentFailure);
    assert.equal(error.usage?.exact, true);
    assert.equal(error.usage?.outputTokens, 5);
    return true;
  });
});
test('stream failure retains partial usage and marks final accounting uncertain', async t => {
  mockStream(t, 'end_turn', true);
  await assert.rejects(runAgent(request, 500, async () => {}, new AbortController().signal), error => {
    assert.ok(error instanceof AgentFailure);
    assert.equal(error.usage?.exact, false);
    assert.equal(error.usage?.inputTokens, 100);
    return true;
  });
});
test('cancellation before submission incurs no provider usage', async t => {
  const captured = mockStream(t);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runAgent(request, 500, async () => {}, controller.signal), error => {
    assert.ok(error instanceof AgentFailure); assert.equal(error.usage, undefined); return true;
  });
  assert.equal(captured().parameters, undefined);
});
test('reservation input estimate includes a conservative byte bound', async t => {
  t.mock.method(Anthropic.Messages.prototype, 'countTokens', async () => ({ input_tokens: 1 }));
  assert.ok(await estimateInput(request) > Buffer.byteLength(buildPrompt(request)) + 1024);
});

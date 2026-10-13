import test from 'node:test';
import assert from 'node:assert/strict';
import { SSEParser, consumeResponse } from '../apps/cli/src/stream';

function response(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
test('handles split CRLF frames, comments, event IDs and Unicode', async () => {
  const events: unknown[] = [];
  await consumeResponse(response(': keepalive\r\n\r\nid: 1\r\ndata: {"event":"DELTA","data":{"text":"हाय 🚀"}}\r\n\r\ndata: {"event":"COMPLETED","data":{"success":true}}\n\n'), event => events.push(event));
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], { event: 'DELTA', data: { text: 'हाय 🚀' } });
});
test('HTTP errors, truncated streams and explicit failures reject', async () => {
  await assert.rejects(consumeResponse(new Response('{"error":"Quota exhausted"}', { status: 403 }), () => {}), /HTTP 403: Quota exhausted/);
  await assert.rejects(consumeResponse(response('data: {"event":"DELTA","data":{"text":"partial"}}\n\n'), () => {}), /before the task completed/);
  await assert.rejects(consumeResponse(response('data: {"event":"FAILED","data":{"error":"provider failed"}}\n\n'), () => {}), /provider failed/);
  await assert.rejects(consumeResponse(response('data: {"event":"CANCELLED","data":{}}\n\n'), () => {}), /cancelled/);
  await assert.rejects(consumeResponse(response('data: {"event":"COMPLETED","data":{"success":false}}\n\n'), () => {}), /did not complete/);
});
test('malformed stream frames reject instead of being silently swallowed', () => {
  assert.throws(() => new SSEParser().push('data: invalid\n\n'), SyntaxError);
  assert.throws(() => new SSEParser().push('data: {"event":"DELTA"}\n\n'), /Invalid stream event/);
});

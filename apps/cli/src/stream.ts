export type StreamEvent = { event: string; data: Record<string, unknown> };

export class SSEParser {
  private buffer = '';
  push(chunk: string): StreamEvent[] {
    this.buffer += chunk;
    if (this.buffer.length > 1024 * 1024) throw new Error('Stream frame is too large');
    const result: StreamEvent[] = [];
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const frame = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const lines = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, ''));
      if (!lines.length) continue;
      const value = JSON.parse(lines.join('\n'));
      if (typeof value.event !== 'string' || !value.data || typeof value.data !== 'object') throw new Error('Invalid stream event');
      result.push(value);
    }
    return result;
  }
}

export async function consumeResponse(response: Response, onEvent: (event: StreamEvent) => void): Promise<void> {
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try { message = JSON.parse(body).error || body; } catch { /* Plain text HTTP error. */ }
    throw new Error(`HTTP ${response.status}: ${message.slice(0, 500)}`);
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new Error('Server did not return an event stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SSEParser();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error('Connection ended before the task completed');
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        if (event.event === 'FAILED' || event.event === 'CANCELLED') throw new Error(String(event.data.error || 'Task cancelled'));
        if (event.event === 'COMPLETED') {
          if (event.data.success !== true) throw new Error('Task did not complete successfully');
          onEvent(event);
          return;
        }
        onEvent(event);
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

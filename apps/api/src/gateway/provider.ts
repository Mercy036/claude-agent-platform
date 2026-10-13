import { GatewayError } from '@claude-hackathon/database';
import { z } from 'zod';
import type { CountRequest, MessageRequest } from './protocol';

export interface GatewayProvider {
  count(body: CountRequest, signal: AbortSignal): Promise<number>;
  messages(body: MessageRequest, signal: AbortSignal): Promise<Response>;
}
export async function boundedJson(response: Response, maxBytes = 16 * 1024 * 1024): Promise<unknown> {
  if (!response.body) throw new Error('Empty provider response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let length = 0;
  let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new Error('Provider response too large');
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function providerError(response: Response, value: unknown): GatewayError {
  const parsed = z.object({ error: z.object({ type: z.string(), message: z.string() }) }).safeParse(value);
  if (response.status === 401 || response.status === 403) return new GatewayError('Organizer provider credentials need attention', 502, 'api_error');
  const status = [400, 404, 413, 429, 500, 502, 503, 529].includes(response.status) ? response.status : 502;
  return new GatewayError(parsed.success ? parsed.data.error.message.slice(0, 1000) : 'Model provider request failed', status, status === 429 ? 'rate_limit_error' : parsed.success ? parsed.data.error.type : 'api_error');
}
export function createProvider(): GatewayProvider {
  const call = (route: string, body: unknown, signal: AbortSignal) => {
    if (!process.env.ANTHROPIC_API_KEY) throw new GatewayError('Organizer provider key is not configured', 503, 'api_error');
    return fetch(`https://api.anthropic.com/v1/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body), signal, redirect: 'error',
    });
  };
  return {
    async count(body, signal) {
      const response = await call('messages/count_tokens', body, signal);
      const value = await boundedJson(response, 1024 * 1024);
      if (!response.ok) throw providerError(response, value);
      return z.object({ input_tokens: z.number().int().min(0).max(1000000000) }).parse(value).input_tokens;
    },
    messages: (body, signal) => call('messages', body, signal),
  };
}

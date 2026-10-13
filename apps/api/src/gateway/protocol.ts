import { z } from 'zod';
import { GatewayError } from '@claude-hackathon/database';

const text = z.object({ type: z.literal('text'), text: z.string() }).strict();
const image = z.object({ type: z.literal('image'), source: z.object({
  type: z.literal('base64'), media_type: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
  data: z.string().min(1).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict() }).strict();
const toolUse = z.object({ type: z.literal('tool_use'), id: z.string().min(1), name: z.string().min(1), input: z.record(z.unknown()) }).strict();
const toolResult = z.object({ type: z.literal('tool_result'), tool_use_id: z.string().min(1),
  content: z.union([z.string(), z.array(z.union([text, image])).max(32)]).optional(), is_error: z.boolean().optional(),
}).strict();
const message = z.object({ role: z.enum(['user', 'assistant']), content: z.union([z.string(), z.array(z.union([text, image, toolUse, toolResult])).min(1).max(64)]) }).strict();
const tool = z.object({ name: z.string().min(1).max(64), description: z.string().optional(), input_schema: z.record(z.unknown()) }).strict();
const common = {
  model: z.string().min(1).max(100), messages: z.array(message).min(1).max(256),
  system: z.union([z.string(), z.array(text).max(32)]).optional(), tools: z.array(tool).max(64).optional(),
  tool_choice: z.union([
    z.object({ type: z.enum(['auto', 'any', 'none']), disable_parallel_tool_use: z.boolean().optional() }).strict(),
    z.object({ type: z.literal('tool'), name: z.string(), disable_parallel_tool_use: z.boolean().optional() }).strict(),
  ]).optional(),
};
export const CountRequestSchema = z.object(common).strict();
export const MessageRequestSchema = z.object({ ...common,
  max_tokens: z.number().int().min(1).max(32768), stream: z.boolean().default(false),
  temperature: z.number().min(0).max(1).optional(), top_p: z.number().min(0).max(1).optional(), top_k: z.number().int().min(0).optional(),
  stop_sequences: z.array(z.string().max(256)).max(16).optional(),
  metadata: z.object({ user_id: z.string().max(256).optional() }).strict().optional(),
}).strict();
export type MessageRequest = z.infer<typeof MessageRequestSchema>;
export type CountRequest = z.infer<typeof CountRequestSchema>;
export type ModelPrice = { inputMicrosPerToken: number; outputMicrosPerToken: number };
const price = z.object({ inputMicrosPerToken: z.number().int().min(1).max(1000), outputMicrosPerToken: z.number().int().min(1).max(1000) }).strict();
export function gatewayConfig(env: NodeJS.ProcessEnv = process.env) {
  const models = z.record(price).parse(env.GATEWAY_MODEL_PRICES_JSON ? JSON.parse(env.GATEWAY_MODEL_PRICES_JSON) : {
    'claude-haiku-4-5': { inputMicrosPerToken: 1, outputMicrosPerToken: 5 },
    'claude-haiku-4-5-20251001': { inputMicrosPerToken: 1, outputMicrosPerToken: 5 },
  });
  if (!Object.keys(models).length) throw new Error('Configure at least one gateway model');
  const globalConcurrency = z.coerce.number().int().min(1).max(100).parse(env.GATEWAY_MAX_CONCURRENT_REQUESTS || 5);
  const maxOutputTokens = z.coerce.number().int().min(1).max(32768).parse(env.GATEWAY_MAX_OUTPUT_TOKENS || 8192);
  return { models, globalConcurrency, maxOutputTokens };
}
export function modelPrice(models: Record<string, ModelPrice>, model: string) {
  if (!Object.hasOwn(models, model)) throw new GatewayError('Model is not enabled on this gateway');
  return models[model];
}
export function countPayload(body: MessageRequest): CountRequest {
  return CountRequestSchema.parse({ model: body.model, messages: body.messages, system: body.system, tools: body.tools, tool_choice: body.tool_choice });
}
export function inputBudget(body: CountRequest, estimated: number) {
  const json = JSON.stringify(body);
  // Byte bound plus framing/vision allowance for every permitted content block.
  let blocks = 1 + (Array.isArray(body.system) ? body.system.length : 1) + (body.tools?.length || 0);
  for (const item of body.messages) {
    blocks += Array.isArray(item.content) ? item.content.length : 1;
    if (Array.isArray(item.content)) for (const block of item.content) {
      if (block.type === 'tool_result' && Array.isArray(block.content)) blocks += block.content.length;
    }
  }
  return Math.max(Math.ceil(estimated * 1.05) + 256, Buffer.byteLength(json, 'utf8') + blocks * 2048);
}
const usageSchema = z.object({ input_tokens: z.number().int().min(0).max(1000000000), output_tokens: z.number().int().min(0).max(1000000000),
  cache_creation_input_tokens: z.number().int().min(0).optional(), cache_read_input_tokens: z.number().int().min(0).optional(),
}).passthrough();
export function providerUsage(value: unknown) {
  const parsed = usageSchema.parse(value);
  if (parsed.cache_creation_input_tokens || parsed.cache_read_input_tokens) throw new Error('Unexpected cached usage requires reconciliation');
  return { inputTokens: parsed.input_tokens, outputTokens: parsed.output_tokens };
}

export class ProviderFrameParser {
  private buffer = '';
  push(chunk: string): { frame: string; value: Record<string, unknown> | null }[] {
    this.buffer += chunk;
    if (this.buffer.length > 2 * 1024 * 1024) throw new Error('Provider frame too large');
    const frames: { frame: string; value: Record<string, unknown> | null }[] = [];
    let separator: RegExpExecArray | null;
    while ((separator = /\r?\n\r?\n/.exec(this.buffer))) {
      const frame = this.buffer.slice(0, separator.index + separator[0].length);
      this.buffer = this.buffer.slice(frame.length);
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      const value = data ? z.record(z.unknown()).parse(JSON.parse(data)) : null;
      frames.push({ frame, value });
    }
    return frames;
  }
}

import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import { db } from '@claude-hackathon/database';
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const runAgent = async (
  sessionId: string,
  task: string,
  onEvent: (event: string, data: any) => void
) => {
  onEvent('LOG', { message: 'Agent initialized. Connecting to Claude...' });
  onEvent('LOG', { message: `Task received: ${task}` });

  try {
    const session = await db.agentSession.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!session) throw new Error('Session not found');

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const stream = await anthropic.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      system: `You are a world-class coding AI assistant running directly in the user's terminal via a Hackathon Platform.
Your goal is to help them build their hackathon project.
If you need to create or modify a file on their computer, you MUST wrap the exact file contents in this exact syntax so the CLI can execute it:
<<<FILE: relative/path/to/file.ts>>>
// exact file content here
<<<ENDFILE>>>
You can create multiple files in a single response by using this syntax multiple times. Always write complete files.
Explain what you are doing clearly before writing the file.`,
      messages: [
        { role: 'user', content: task }
      ],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const delta = event.delta.text;
        fullContent += delta;
        onEvent('DELTA', { text: delta });
      }

      if (event.type === 'message_delta' && event.usage) {
        outputTokens = event.usage.output_tokens;
      }

      if (event.type === 'message_start' && event.message.usage) {
        inputTokens = event.message.usage.input_tokens;
      }
    }

    onEvent('LOG', { message: `\nFinished generating code.` });

    const totalTokens = inputTokens + outputTokens;

    await db.tokenUsage.create({
      data: {
        userId: session.userId,
        sessionId,
        requestId: `req_${Date.now()}`,
        inputTokens,
        outputTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens,
        model: MODEL,
      }
    });

    await db.user.update({
      where: { id: session.userId },
      data: { tokensUsed: { increment: totalTokens } }
    });

    onEvent('COMPLETED', { success: true });
  } catch (error: any) {
    onEvent('LOG', { message: `Error from Claude: ${error.message}` });
    throw error;
  }
};

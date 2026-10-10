import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import { db } from '@claude-hackathon/database';
import OpenAI from 'openai';

const MODEL = 'gpt-6-luna';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const runAgent = async (
  sessionId: string,
  task: string,
  onEvent: (event: string, data: any) => void
) => {
  onEvent('LOG', { message: 'Agent initialized. Connecting to OpenAI...' });
  onEvent('LOG', { message: `Task received: ${task}` });

  try {
    const session = await db.agentSession.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!session) throw new Error('Session not found');

    const stream = await openai.chat.completions.create({
      model: MODEL,
      stream: true,
      stream_options: { include_usage: true },
      reasoning_effort: 'medium',
      max_completion_tokens: 4096,
      messages: [
        {
          role: 'system',
          content: `You are a world-class coding AI assistant running directly in the user's terminal via a Hackathon Platform. 
Your goal is to help them build their hackathon project.
If you need to create or modify a file on their computer, you MUST wrap the exact file contents in this exact syntax so the CLI can execute it:
<<<FILE: relative/path/to/file.ts>>>
// exact file content here
<<<ENDFILE>>>
You can create multiple files in a single response by using this syntax multiple times. Always write complete files.
Explain what you are doing clearly before writing the file.`
        },
        { role: 'user', content: task }
      ],
    });

    let fullContent = '';
    let currentInputTokens = 0;
    let currentOutputTokens = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullContent += delta;
        // Stream the raw delta down to the CLI immediately
        onEvent('DELTA', { text: delta });
      }
      // Capture usage from the final chunk
      if (chunk.usage) {
        currentInputTokens = chunk.usage.prompt_tokens;
        currentOutputTokens = chunk.usage.completion_tokens;
      }
    }

    onEvent('LOG', { message: `\nFinished generating code.` });

    // Track real token usage in the database
    const totalTokens = currentInputTokens + currentOutputTokens;
    await db.tokenUsage.create({
      data: {
        userId: session.userId,
        sessionId,
        requestId: `req_${Date.now()}`,
        inputTokens: currentInputTokens,
        outputTokens: currentOutputTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: totalTokens,
        model: MODEL,
      }
    });

    await db.user.update({
      where: { id: session.userId },
      data: { tokensUsed: { increment: totalTokens } }
    });

    onEvent('COMPLETED', { success: true });
  } catch (error: any) {
    onEvent('LOG', { message: `Error from OpenAI: ${error.message}` });
    throw error;
  }
};

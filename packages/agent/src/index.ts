import { db } from '@claude-hackathon/database';
import Anthropic from '@anthropic-ai/sdk';

// Initialize SDK (using a dummy key if not provided)
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'dummy_key',
});

export const runAgent = async (
  sessionId: string,
  task: string,
  onEvent: (event: string, data: any) => void
) => {
  onEvent('LOG', { message: 'Agent initialized...' });
  onEvent('LOG', { message: `Task received: ${task}` });

  // Mocking the agent work loop
  const steps = [
    'Inspecting project environment...',
    'Reading package.json...',
    'Creating required files...',
    'Running tests...',
    'Fixing lint errors...',
  ];

  for (const step of steps) {
    onEvent('LOG', { message: step });
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  // Record mock token usage
  const session = await db.agentSession.findUnique({ where: { id: sessionId } });
  if (session) {
    const inputTokens = Math.floor(Math.random() * 500) + 100;
    const outputTokens = Math.floor(Math.random() * 800) + 200;
    
    await db.tokenUsage.create({
      data: {
        userId: session.userId,
        sessionId,
        requestId: `req_${Date.now()}`,
        inputTokens,
        outputTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: inputTokens + outputTokens,
        model: 'claude-3-haiku-20240307',
      }
    });

    await db.user.update({
      where: { id: session.userId },
      data: {
        tokensUsed: { increment: inputTokens + outputTokens }
      }
    });

    onEvent('LOG', { message: `Task complete. Tokens used: ${inputTokens + outputTokens}` });
  }

  onEvent('COMPLETED', { success: true });
};

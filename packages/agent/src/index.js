"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAgent = void 0;
const database_1 = require("@claude-hackathon/database");
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
// Initialize SDK (using a dummy key if not provided)
const anthropic = new sdk_1.default({
    apiKey: process.env.ANTHROPIC_API_KEY || 'dummy_key',
});
const runAgent = async (sessionId, task, onEvent) => {
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
    const session = await database_1.db.agentSession.findUnique({ where: { id: sessionId } });
    if (session) {
        const inputTokens = Math.floor(Math.random() * 500) + 100;
        const outputTokens = Math.floor(Math.random() * 800) + 200;
        await database_1.db.tokenUsage.create({
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
        await database_1.db.user.update({
            where: { id: session.userId },
            data: {
                tokensUsed: { increment: inputTokens + outputTokens }
            }
        });
        onEvent('LOG', { message: `Task complete. Tokens used: ${inputTokens + outputTokens}` });
    }
    onEvent('COMPLETED', { success: true });
};
exports.runAgent = runAgent;
//# sourceMappingURL=index.js.map
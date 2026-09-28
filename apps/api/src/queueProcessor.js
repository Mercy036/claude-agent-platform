"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startQueueProcessor = startQueueProcessor;
const queue_1 = require("@claude-hackathon/queue");
const database_1 = require("@claude-hackathon/database");
const agent_1 = require("@claude-hackathon/agent");
const pubsub_1 = require("./pubsub");
function startQueueProcessor() {
    console.log('Starting BullMQ Queue Processor...');
    (0, queue_1.createAgentWorker)(async (job) => {
        const { sessionId, userId, task, cwd } = job.data;
        // Update session status to RUNNING
        await database_1.db.agentSession.update({
            where: { id: sessionId },
            data: { status: 'RUNNING', startedAt: new Date() }
        });
        try {
            console.log(`Agent starting for session ${sessionId}`);
            const onEvent = (event, data) => {
                (0, pubsub_1.publishEvent)(sessionId, event, data);
            };
            // Run the actual agent
            await (0, agent_1.runAgent)(sessionId, task, onEvent);
            // Update session status to COMPLETED
            await database_1.db.agentSession.update({
                where: { id: sessionId },
                data: { status: 'COMPLETED', endedAt: new Date() }
            });
            console.log(`Agent completed for session ${sessionId}`);
        }
        catch (error) {
            console.error(`Agent failed for session ${sessionId}:`, error);
            (0, pubsub_1.publishEvent)(sessionId, 'FAILED', { error: 'Internal error' });
            // Update session status to FAILED
            await database_1.db.agentSession.update({
                where: { id: sessionId },
                data: { status: 'FAILED', endedAt: new Date() }
            });
            throw error;
        }
    });
}
//# sourceMappingURL=queueProcessor.js.map
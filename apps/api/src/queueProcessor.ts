import { createAgentWorker } from '@claude-hackathon/queue';
import { db } from '@claude-hackathon/database';
import { runAgent } from '@claude-hackathon/agent';
import { publishEvent } from './pubsub';

export function startQueueProcessor() {
  console.log('Starting BullMQ Queue Processor...');
  
  createAgentWorker(async (job) => {
    const { sessionId, userId, task, cwd } = job.data;
    
    // Update session status to RUNNING
    await db.agentSession.update({
      where: { id: sessionId },
      data: { status: 'RUNNING', startedAt: new Date() }
    });

    try {
      console.log(`Agent starting for session ${sessionId}`);
      
      const onEvent = (event: string, data: any) => {
        publishEvent(sessionId, event, data);
      };

      // Run the actual agent
      await runAgent(sessionId, task, onEvent);
      
      // Update session status to COMPLETED
      await db.agentSession.update({
        where: { id: sessionId },
        data: { status: 'COMPLETED', endedAt: new Date() }
      });
      console.log(`Agent completed for session ${sessionId}`);
    } catch (error) {
      console.error(`Agent failed for session ${sessionId}:`, error);
      
      publishEvent(sessionId, 'FAILED', { error: 'Internal error' });

      // Update session status to FAILED
      await db.agentSession.update({
        where: { id: sessionId },
        data: { status: 'FAILED', endedAt: new Date() }
      });
      throw error;
    }
  });
}

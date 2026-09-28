import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import type { AgentTask } from '@claude-hackathon/shared';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const agentQueue = new Queue<AgentTask>('agent-queue', { connection });
export const agentQueueEvents = new QueueEvents('agent-queue', { connection });

export const createAgentWorker = (
  processor: (job: any) => Promise<any>,
  concurrency: number = 5
) => {
  return new Worker<AgentTask>('agent-queue', processor, {
    connection,
    concurrency,
  });
};

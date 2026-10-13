import { Queue, Worker, type Processor } from 'bullmq';
import IORedis from 'ioredis';
import type { AgentTask } from '@claude-hackathon/shared';

export function configuredConcurrency() {
  const value = Number(process.env.MAX_CONCURRENT_AGENTS || 5);
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error('MAX_CONCURRENT_AGENTS must be an integer between 1 and 100');
  return value;
}

export function createQueue() {
  const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  connection.on('error', error => console.error('Queue Redis error:', error.message));
  const queue = new Queue<AgentTask>('agent-queue', { connection });
  return { queue, connection };
}

export async function createAgentWorker(processor: Processor<AgentTask>) {
  const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
  connection.on('error', error => console.error('Worker Redis error:', error.message));
  // This is a global limit, including multiple API/worker replicas.
  const queue = new Queue<AgentTask>('agent-queue', { connection });
  await queue.setGlobalConcurrency(configuredConcurrency());
  const worker = new Worker<AgentTask>('agent-queue', processor, { connection, concurrency: configuredConcurrency(), maxStalledCount: 0 });
  await worker.waitUntilReady();
  worker.on('error', error => console.error('Worker error:', error.message));
  return { worker, queue, connection };
}

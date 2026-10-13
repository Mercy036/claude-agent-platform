import Redis from 'ioredis';
import type { EventSink } from '@claude-hackathon/shared';

export const streamKey = (sessionId: string) => `session-events:${sessionId}`;
export function createEventStore() {
  const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  connection.on('error', error => console.error('Event Redis error:', error.message));
  const publish = (sessionId: string): EventSink => async (event, data) => {
    const result = await connection.multi()
      .xadd(streamKey(sessionId), '*', 'message', JSON.stringify({ event, data }))
      .expire(streamKey(sessionId), 3600)
      .exec();
    if (!result || result.some(([error]) => error)) throw new Error('Could not persist stream event');
  };
  return { connection, publish };
}

import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisPublisher = new Redis(REDIS_URL);
export const redisSubscriber = new Redis(REDIS_URL);

export function publishEvent(sessionId: string, event: string, data: any) {
  const channel = `session:${sessionId}`;
  redisPublisher.publish(channel, JSON.stringify({ event, data }));
}

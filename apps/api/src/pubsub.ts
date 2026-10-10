import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisPublisher = new Redis(REDIS_URL);
export const redisSubscriber = new Redis(REDIS_URL);

export function publishEvent(sessionId: string, event: string, data: any) {
  const channel = `session:${sessionId}`;
  const message = JSON.stringify({ event, data });
  // Buffer event in a list so late-connecting clients can replay
  const bufferKey = `session-buffer:${sessionId}`;
  redisPublisher.rpush(bufferKey, message);
  redisPublisher.expire(bufferKey, 300); // 5 min TTL
  redisPublisher.publish(channel, message);
}

import Redis from 'ioredis';
export declare const redisPublisher: Redis;
export declare const redisSubscriber: Redis;
export declare function publishEvent(sessionId: string, event: string, data: any): void;

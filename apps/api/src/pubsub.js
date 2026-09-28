"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisSubscriber = exports.redisPublisher = void 0;
exports.publishEvent = publishEvent;
const ioredis_1 = __importDefault(require("ioredis"));
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
exports.redisPublisher = new ioredis_1.default(REDIS_URL);
exports.redisSubscriber = new ioredis_1.default(REDIS_URL);
function publishEvent(sessionId, event, data) {
    const channel = `session:${sessionId}`;
    exports.redisPublisher.publish(channel, JSON.stringify({ event, data }));
}
//# sourceMappingURL=pubsub.js.map
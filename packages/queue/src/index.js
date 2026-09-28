"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAgentWorker = exports.agentQueueEvents = exports.agentQueue = void 0;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const connection = new ioredis_1.default(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
});
exports.agentQueue = new bullmq_1.Queue('agent-queue', { connection });
exports.agentQueueEvents = new bullmq_1.QueueEvents('agent-queue', { connection });
const createAgentWorker = (processor, concurrency = 5) => {
    return new bullmq_1.Worker('agent-queue', processor, {
        connection,
        concurrency,
    });
};
exports.createAgentWorker = createAgentWorker;
//# sourceMappingURL=index.js.map
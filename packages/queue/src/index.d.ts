import { Queue, Worker, QueueEvents } from 'bullmq';
export declare const agentQueue: Queue<{
    sessionId: string;
    userId: string;
    task: string;
    cwd: string;
}, any, string, {
    sessionId: string;
    userId: string;
    task: string;
    cwd: string;
}, any, string>;
export declare const agentQueueEvents: QueueEvents;
export declare const createAgentWorker: (processor: (job: any) => Promise<any>, concurrency?: number) => Worker<{
    sessionId: string;
    userId: string;
    task: string;
    cwd: string;
}, any, string>;

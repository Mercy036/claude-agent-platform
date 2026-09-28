import { z } from 'zod';
export declare const AgentTaskSchema: z.ZodObject<{
    sessionId: z.ZodString;
    userId: z.ZodString;
    task: z.ZodString;
    cwd: z.ZodString;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    userId: string;
    task: string;
    cwd: string;
}, {
    sessionId: string;
    userId: string;
    task: string;
    cwd: string;
}>;
export type AgentTask = z.infer<typeof AgentTaskSchema>;

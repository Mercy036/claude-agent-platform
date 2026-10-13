import { z } from 'zod';

export const AgentTaskSchema = z.object({
  sessionId: z.string(),
});

export type AgentTask = z.infer<typeof AgentTaskSchema>;

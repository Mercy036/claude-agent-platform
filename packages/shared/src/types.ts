import { z } from 'zod';

export const AgentTaskSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  task: z.string(),
  cwd: z.string(),
});

export type AgentTask = z.infer<typeof AgentTaskSchema>;

import { z } from 'zod';

export const MAX_CONTEXT_BYTES = 128 * 1024;
export const MAX_FILE_BYTES = 32 * 1024;
export const MAX_FILES = 32;

export function validateProjectPath(value: string): string {
  const parts = value.split('/');
  if (!value || value.length > 240 || /[\\:\x00-\x1f\x7f-\x9f<>"|?*]/.test(value) || value.startsWith('/') ||
      parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) ||
        /^(con|conin\$|conout\$|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part) ||
        (part.startsWith('.') && !['.gitignore', '.env.example'].includes(part)) ||
        ['node_modules', 'dist', 'vendor'].includes(part.toLowerCase()))) {
    throw new Error(`Unsafe project path: ${value}`);
  }
  return value;
}

export const ProjectFileSchema = z.object({
  path: z.string().refine(value => { try { validateProjectPath(value); return true; } catch { return false; } }),
  content: z.string().refine(value => Buffer.byteLength(value, 'utf8') <= MAX_FILE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const AgentRequestSchema = z.object({
  task: z.string().trim().min(1).max(16000),
  files: z.array(ProjectFileSchema).max(MAX_FILES).default([]),
}).superRefine(({ files }, ctx) => {
  if (new Set(files.map(file => file.path.toLowerCase())).size !== files.length) {
    ctx.addIssue({ code: 'custom', message: 'Duplicate project paths' });
  }
  if (files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0) > MAX_CONTEXT_BYTES) {
    ctx.addIssue({ code: 'custom', message: 'Project context is too large' });
  }
});
export type AgentRequest = z.infer<typeof AgentRequestSchema>;
export type ProjectFile = z.infer<typeof ProjectFileSchema>;
export type AgentEvent = 'QUEUED' | 'LOG' | 'DELTA' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type EventSink = (event: AgentEvent, data: Record<string, unknown>) => Promise<void>;

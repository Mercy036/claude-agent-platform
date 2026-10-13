import { createAgentWorker } from '@claude-hackathon/queue';
import { db, claimSession, settleSession, cancelSession, type Usage } from '@claude-hackathon/database';
import { runAgent, AgentFailure, MODEL } from '@claude-hackathon/agent';
import { AgentRequestSchema } from '@claude-hackathon/shared';
import { createEventStore } from './pubsub';

export async function startQueueProcessor() {
  const events = createEventStore();
  const active = new Map<string, AbortController>();
  const resources = await createAgentWorker(async job => {
    const session = await claimSession(job.data.sessionId);
    if (!session) {
      const existing = await db.agentSession.findUnique({ where: { id: job.data.sessionId } });
      if (existing?.status === 'QUEUED') await cancelSession(existing.id);
      return;
    }
    const controller = new AbortController();
    active.set(session.id, controller);
    const publish = events.publish(session.id);
    // Polling makes cancellation work across replicas without a PubSub race.
    let checking = false;
    const timer = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const current = await db.agentSession.findUnique({ where: { id: session.id }, include: { user: true } });
        if (!current || current.status !== 'RUNNING' || current.user.status !== 'ACTIVE') controller.abort();
        else await db.agentSession.update({ where: { id: session.id }, data: { lastActivity: new Date() } });
      } catch { controller.abort(); }
      finally { checking = false; }
    }, 1000);
    const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);
    let reportedUsage: Usage | undefined;
    try {
      const request = AgentRequestSchema.parse(session.request);
      const usage = await runAgent(request, session.maxOutputTokens, publish, controller.signal);
      reportedUsage = usage;
      const settled = await settleSession(session.id, 'COMPLETED', usage);
      await publish(settled.status === 'COMPLETED' ? 'COMPLETED' : settled.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED', { success: settled.status === 'COMPLETED' });
    } catch (error) {
      const usage = error instanceof AgentFailure ? error.usage : reportedUsage;
      const settled = await settleSession(session.id, controller.signal.aborted ? 'CANCELLED' : 'FAILED', usage);
      await publish(settled.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED', { error: error instanceof AgentFailure ? error.message : 'Agent task failed' });
    } finally {
      clearInterval(timer); clearTimeout(timeout); active.delete(session.id);
    }
  });
  // A worker crash must never re-submit a potentially billed provider request.
  resources.worker.on('failed', (job, error) => {
    if (!job) return;
    void settleSession(job.data.sessionId, 'FAILED', { inputTokens: 0, outputTokens: 0, exact: false, model: MODEL, requestId: '' })
      .then(() => events.publish(job.data.sessionId)('FAILED', { error: 'Worker stopped; reserved quota charged conservatively' }))
      .catch(err => console.error('Failed to reconcile worker job:', err));
    console.error('Job failed:', error.message);
  });
  // The database request is an outbox. Recover a crash between reservation and
  // Redis enqueueing using deterministic job IDs; no prompt is stored in Redis.
  let reconciling = false;
  const reconcile = async () => {
    if (reconciling) return;
    reconciling = true;
    try {
      const sessions = await db.agentSession.findMany({ where: { status: 'QUEUED', settledAt: null }, take: 500, orderBy: { createdAt: 'asc' } });
      for (const session of sessions) {
        if (!session.request || Date.now() - session.createdAt.getTime() > 60 * 60 * 1000) { await cancelSession(session.id); continue; }
        await resources.queue.add('agent-task', { sessionId: session.id }, { jobId: session.id, attempts: 1, removeOnComplete: { age: 3600, count: 1000 }, removeOnFail: { age: 86400, count: 1000 } });
      }
      const abandoned = await db.agentSession.findMany({ where: {
        status: { in: ['RUNNING', 'CANCELLED'] }, settledAt: null,
        lastActivity: { lt: new Date(Date.now() - 2 * 60 * 1000) },
      }, take: 500 });
      for (const session of abandoned) {
        await settleSession(session.id, 'FAILED', { inputTokens: 0, outputTokens: 0, exact: false, model: MODEL, requestId: '' });
        await events.publish(session.id)('FAILED', { error: 'Worker connection lost; reserved quota charged conservatively' });
      }
    } catch (error) { console.error('Queue reconciliation failed:', error); }
    finally { reconciling = false; }
  };
  const reconcileTimer = setInterval(() => { void reconcile(); }, 15000);
  await reconcile();
  return async () => {
    clearInterval(reconcileTimer);
    for (const controller of active.values()) controller.abort();
    await resources.worker.close();
    await resources.queue.close();
    await resources.connection.quit();
    await events.connection.quit();
  };
}

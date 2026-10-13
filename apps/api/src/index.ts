import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function start() {
  // Load modules after configuration so Redis and provider options see .env.
  const { readConfig } = await import('./config');
  const config = readConfig();
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required');
  const { buildServer } = await import('./server');
  const { startQueueProcessor } = await import('./queueProcessor');
  const { db, recoverGatewayReservations } = await import('@claude-hackathon/database');
  const server = await buildServer(config);
  await db.$connect();
  // Refuse to serve a gateway whose credit ledger migration has not been applied.
  await Promise.all([db.team.count(), db.gatewayRequest.count(), db.teamCreditChange.count()]);
  const stopWorker = process.env.ENABLE_CODING_ASSISTANT === 'true' ? await startQueueProcessor() : async () => {};
  let recovering = false;
  const recover = async () => {
    if (recovering) return;
    recovering = true;
    try { await recoverGatewayReservations(); }
    catch (error) { server.log.error(error); }
    finally { recovering = false; }
  };
  await recover();
  const recoveryTimer = setInterval(() => { void recover(); }, 30000);
  await server.listen({ port: config.port, host: '0.0.0.0' });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(recoveryTimer);
    await stopWorker();
    await server.close();
    await db.$disconnect();
  };
  process.once('SIGTERM', () => { void stop().catch(console.error); });
  process.once('SIGINT', () => { void stop().catch(console.error); });
}
start().catch(error => { console.error(error.message); process.exit(1); });

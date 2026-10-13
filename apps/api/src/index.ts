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
  const { db } = await import('@claude-hackathon/database');
  const server = await buildServer(config);
  await db.$connect();
  const stopWorker = await startQueueProcessor();
  await server.listen({ port: config.port, host: '0.0.0.0' });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await stopWorker();
    await server.close();
    await db.$disconnect();
  };
  process.once('SIGTERM', () => { void stop().catch(console.error); });
  process.once('SIGINT', () => { void stop().catch(console.error); });
}
start().catch(error => { console.error(error.message); process.exit(1); });

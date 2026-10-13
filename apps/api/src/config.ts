export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32 || /super-secret|placeholder|change-in-production/i.test(jwtSecret)) {
    throw new Error('JWT_SECRET must be a unique secret of at least 32 characters');
  }
  const port = Number(env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const origins = (env.CORS_ORIGINS || 'http://localhost:3000').split(',').map(value => value.trim()).filter(Boolean);
  if (origins.includes('*')) throw new Error('CORS_ORIGINS must contain explicit trusted origins');
  return { jwtSecret, port, origins };
}

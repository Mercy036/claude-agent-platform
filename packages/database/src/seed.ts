import dotenv from 'dotenv';
import path from 'path';
import bcrypt from 'bcrypt';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
let db: typeof import('./index').db;

async function main() {
  db = (await import('./index')).db;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || Buffer.byteLength(password) < 12 || Buffer.byteLength(password) > 72) {
    throw new Error('Set ADMIN_EMAIL and an ADMIN_PASSWORD of 12–72 UTF-8 bytes before seeding');
  }
  const hashed = await bcrypt.hash(password, 12);
  await db.user.upsert({ where: { email },
    create: { email, name: 'Admin', password: hashed, role: 'ADMIN', tokenLimit: 1000000000 },
    update: { password: hashed, role: 'ADMIN', status: 'ACTIVE', authVersion: { increment: 1 } },
  });
  console.log('Admin password set; existing admin tokens revoked');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db?.$disconnect());

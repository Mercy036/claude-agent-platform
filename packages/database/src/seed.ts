import { db } from './index';

async function main() {
  console.log('Seeding database...');

  // Create default admin user
  const adminEmail = 'admin@claude-hackathon.com';
  const existingAdmin = await db.user.findUnique({ where: { email: adminEmail } });
  
  if (!existingAdmin) {
    await db.user.create({
      data: {
        name: 'Admin',
        email: adminEmail,
        // In a real app, hash this password before storing.
        password: 'admin-password',
        role: 'ADMIN',
        tokenLimit: 999999999,
        team: 'Organizers'
      }
    });
    console.log('Created default admin user');
  }

  // Create default settings
  const settings = [
    { key: 'HACKATHON_ENABLED', value: 'true' },
    { key: 'DEFAULT_PARTICIPANT_LIMIT', value: '1000000' },
    { key: 'MAX_CONCURRENT_AGENTS', value: '5' },
    { key: 'REGISTRATION_ENABLED', value: 'true' },
    { key: 'AGENT_ACCESS_ENABLED', value: 'true' }
  ];

  for (const setting of settings) {
    await db.setting.upsert({
      where: { key: setting.key },
      update: {},
      create: setting
    });
  }
  console.log('Created default settings');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });

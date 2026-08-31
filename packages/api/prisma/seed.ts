import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import { hashPassword } from '../src/utils/password.js';

config();
config({ path: '../../.env' });
config({ path: '.env' });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const platforms = ['telegram', 'twitch', 'youtube', 'twitter'] as const;
const statuses = ['idle', 'running', 'paused'] as const;

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'admin@botfarm.local' },
    update: {},
    create: {
      email: 'admin@botfarm.local',
      passwordHash: await hashPassword('admin123'),
      name: 'Admin',
      role: 'admin',
    },
  });

  console.log('Created admin user:', user.email);

  for (const platform of platforms) {
    const account = await prisma.account.create({
      data: {
        name: `Demo ${platform} account`,
        platform,
        ownerId: user.id,
      },
    });

    for (let i = 0; i < 3; i++) {
      await prisma.bot.create({
        data: {
          name: `${platform}-bot-${i + 1}`,
          platform,
          status: statuses[Math.floor(Math.random() * statuses.length)],
          accountId: account.id,
          ownerId: user.id,
          config: { pollingInterval: 5000, dailyLimit: 1000 },
        },
      });
    }

    console.log(`Created ${platform} account with 3 bots`);
  }

  console.log('BotHive by ssrjkk — seed completed');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

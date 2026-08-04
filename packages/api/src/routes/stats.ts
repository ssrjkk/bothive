import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../utils/auth-hook.js';

export async function statsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);

  app.get('/', async (request) => {
    const prisma = request.prisma;
    const since = new Date(Date.now() - 86400000);
    const [totalBots, activeBots, totalAccounts, recentLogs, errors24h, totalScripts, enabledScripts, totalWebhooks, enabledWebhooks] = await Promise.all([
      prisma.bot.count(),
      prisma.bot.count({ where: { status: 'running' } }),
      prisma.account.count(),
      prisma.log.count({ where: { createdAt: { gte: since } } }),
      prisma.log.count({ where: { level: 'error', createdAt: { gte: since } } }),
      prisma.script.count(),
      prisma.script.count({ where: { enabled: true } }),
      prisma.webhook.count(),
      prisma.webhook.count({ where: { enabled: true } }),
    ]);

    const platformStats = await prisma.bot.groupBy({ by: ['platform'], _count: { id: true } });
    const statusStats = await prisma.bot.groupBy({ by: ['status'], _count: { id: true } });

    return {
      success: true,
      data: {
        totalBots, activeBots, totalAccounts, recentLogs24h: recentLogs, errors24h,
        totalScripts, enabledScripts, totalWebhooks, enabledWebhooks,
        byPlatform: platformStats, byStatus: statusStats,
      },
    };
  });
}
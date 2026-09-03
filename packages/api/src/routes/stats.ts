import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../utils/auth-hook.js';
import { requestOwnerId } from '../utils/tenancy.js';

export async function statsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);

  app.get('/', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request) => {
    const prisma = request.prisma;
    const ownerId = requestOwnerId(request);
    const since = new Date(Date.now() - 86400000);
    const [
      totalBots,
      activeBots,
      totalAccounts,
      recentLogs,
      errors24h,
      totalScripts,
      enabledScripts,
      totalWebhooks,
      enabledWebhooks,
    ] = await Promise.all([
      prisma.bot.count({ where: { ownerId } }),
      prisma.bot.count({ where: { ownerId, status: 'running' } }),
      prisma.account.count({ where: { ownerId } }),
      prisma.log.count({ where: { bot: { ownerId }, createdAt: { gte: since } } }),
      prisma.log.count({
        where: { bot: { ownerId }, level: 'error', createdAt: { gte: since } },
      }),
      prisma.script.count({ where: { bot: { ownerId } } }),
      prisma.script.count({ where: { bot: { ownerId }, enabled: true } }),
      prisma.webhook.count({ where: { ownerId } }),
      prisma.webhook.count({ where: { ownerId, enabled: true } }),
    ]);

    const platformStats = await prisma.bot.groupBy({
      by: ['platform'],
      where: { ownerId },
      _count: { id: true },
    });
    const statusStats = await prisma.bot.groupBy({
      by: ['status'],
      where: { ownerId },
      _count: { id: true },
    });

    return {
      success: true,
      data: {
        totalBots,
        activeBots,
        totalAccounts,
        recentLogs24h: recentLogs,
        errors24h,
        totalScripts,
        enabledScripts,
        totalWebhooks,
        enabledWebhooks,
        byPlatform: platformStats,
        byStatus: statusStats,
      },
    };
  });
}

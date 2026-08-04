import type { FastifyInstance } from 'fastify';
import { parsePage, withTimeout } from '../utils/query.js';
import { requireAuth } from '../utils/auth-hook.js';

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function logRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);

  app.get('/', async (request) => {
    const query = request.query as { botId?: string; level?: string; limit?: string; offset?: string };
    const where: Record<string, unknown> = {};
    if (query.botId) where.botId = query.botId;
    if (query.level) where.level = query.level;

    const { take, skip } = parsePage(request.query as Record<string, unknown>, { limit: 100, maxLimit: 500 });

    const [logs, total] = await Promise.all([
      request.prisma.log.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: 'desc' },
      }),
      request.prisma.log.count({ where }),
    ]);

    return { success: true, data: { logs, total, limit: take, offset: skip } };
  });

  app.get('/export', async (request, reply) => {
    const query = request.query as { botId?: string; level?: string; limit?: string };
    const where: Record<string, unknown> = {};
    if (query.botId) where.botId = query.botId;
    if (query.level) where.level = query.level;

    const { take } = parsePage(request.query as Record<string, unknown>, { limit: 5000, maxLimit: 50000 });

    const logs = await withTimeout(
      request.prisma.log.findMany({
        where,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      10_000,
      'Log export timed out',
    );

    const header = ['id', 'botId', 'level', 'message', 'meta', 'createdAt'];
    const rows = logs.map((log) =>
      [log.id, log.botId, log.level, log.message, JSON.stringify(log.meta ?? {}), log.createdAt].map(csvEscape).join(','),
    );
    const csv = [header.map(csvEscape).join(','), ...rows].join('\r\n');

    const fileName = `bothive-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
    return reply.send(csv);
  });

  app.get<{ Params: { botId: string } }>('/:botId', async (request) => {
    const logs = await request.prisma.log.findMany({
      where: { botId: request.params.botId },
      take: 200,
      orderBy: { createdAt: 'desc' },
    });
    return { success: true, data: logs };
  });
}
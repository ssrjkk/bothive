import type { FastifyInstance } from 'fastify';
import { enqueueConnect, enqueueDisconnect, getQueue } from '../services/queue.js';
import { extractCredentials } from '../utils/credentials.js';
import { notifyScriptsChanged } from '../services/script-events.js';
import { requireAdmin } from '../utils/auth-hook.js';

// Bulk operations mutate state and touch jobs, so they are admin-only. Per-item
// failures are surfaced as a fixed, controlled message instead of raw
// exception text (which can embed internal paths or dependency error details).
const BULK_OP_ERROR = 'operation failed';

export async function bulkRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAdmin);

  app.post<{ Body: { ids: string[]; action: 'start' | 'stop' | 'restart' | 'delete' } }>(
    '/bots',
    async (request, reply) => {
      const { ids, action } = request.body;
      if (!Array.isArray(ids) || ids.length === 0)
        return reply.status(400).send({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'ids must be a non-empty array' },
        });
      if (ids.length > 100)
        return reply.status(400).send({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Maximum 100 bots per bulk operation' },
        });
      if (action !== 'start' && action !== 'stop' && action !== 'restart' && action !== 'delete') {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'action must be one of: start, stop, restart, delete',
          },
        });
      }

      const results: { id: string; status: string; error?: string }[] = [];

      for (const id of ids) {
        try {
          const bot = await request.prisma.bot.findUnique({
            where: { id },
            include: { account: true },
          });
          if (!bot) {
            results.push({ id, status: 'error', error: 'not found' });
            continue;
          }

          switch (action) {
            case 'start': {
              const creds = extractCredentials(bot);
              await enqueueConnect(bot.id, bot.platform, creds);
              await request.prisma.bot.update({ where: { id }, data: { status: 'connecting' } });
              results.push({ id, status: 'queued' });
              break;
            }
            case 'stop':
              await enqueueDisconnect(bot.id, bot.platform);
              await request.prisma.bot.update({ where: { id }, data: { status: 'idle' } });
              results.push({ id, status: 'queued' });
              break;
            case 'restart': {
              const creds = extractCredentials(bot);
              await enqueueDisconnect(bot.id, bot.platform);
              const queue = getQueue(bot.platform);
              await queue.add(
                'connect',
                { id: bot.id, type: 'connect', botId: bot.id, data: { ...creds } },
                {
                  jobId: `connect-${bot.id}`,
                  delay: 1000,
                  attempts: 1,
                  removeOnComplete: true,
                  removeOnFail: true,
                },
              );
              await request.prisma.bot.update({ where: { id }, data: { status: 'connecting' } });
              results.push({ id, status: 'queued' });
              break;
            }
            case 'delete':
              await enqueueDisconnect(bot.id, bot.platform);
              await request.prisma.log.deleteMany({ where: { botId: id } });
              await request.prisma.script.deleteMany({ where: { botId: id } });
              await request.prisma.bot.delete({ where: { id } });
              results.push({ id, status: 'deleted' });
              break;
          }
        } catch {
          results.push({ id, status: 'error', error: BULK_OP_ERROR });
        }
      }

      return { success: true, data: results };
    },
  );

  app.post<{ Body: { ids: string[]; action: 'enable' | 'disable' | 'delete' } }>(
    '/scripts',
    async (request, reply) => {
      const { ids, action } = request.body;
      if (!Array.isArray(ids) || ids.length === 0)
        return reply.status(400).send({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'ids must be a non-empty array' },
        });
      if (ids.length > 100)
        return reply.status(400).send({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Maximum 100 scripts per bulk operation' },
        });
      if (action !== 'enable' && action !== 'disable' && action !== 'delete') {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'action must be one of: enable, disable, delete',
          },
        });
      }

      const results: { id: string; status: string; error?: string }[] = [];

      for (const id of ids) {
        try {
          const script = await request.prisma.script.findUnique({ where: { id } });
          if (!script) {
            results.push({ id, status: 'error', error: 'not found' });
            continue;
          }

          if (action === 'delete') {
            await request.prisma.script.delete({ where: { id } });
            results.push({ id, status: 'deleted' });
          } else {
            await request.prisma.script.update({
              where: { id },
              data: { enabled: action === 'enable' },
            });
            results.push({ id, status: 'updated' });
          }
        } catch {
          results.push({ id, status: 'error', error: BULK_OP_ERROR });
        }
      }

      notifyScriptsChanged();
      return { success: true, data: results };
    },
  );
}

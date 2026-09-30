import type { FastifyInstance } from 'fastify';
import { assertContractSupported } from '@bothive/core';
import { parsePage } from '../utils/query.js';
import { requireAuth, requireAdmin } from '../utils/auth-hook.js';
import { requestOwnerId, sendNotFound } from '../utils/tenancy.js';
import { enqueueEventReplay } from '../services/queue.js';
import { metrics } from '../metrics/prometheus.js';

/**
 * Event store: every platform event is persisted (with its contract version
 * and idempotency key) so an operator can inspect the history and replay a
 * stored event through the platform worker — re-running scripts, webhooks and
 * AI exactly as on the original emission. This is the "event replay" half of
 * the resilience story: a lost webhook delivery or a script bug discovered
 * after the fact can be re-run without fabricating a fake event.
 *
 * All queries are scoped to the caller's tenant through the bot relation.
 */
export async function eventRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);

  /**
   * Event store analytics (owner-scoped): totals + breakdowns by type and
   * platform, so the dashboard can chart the fleet's event mix without
   * transferring every payload. Index-backed (botId / platform+type).
   */
  app.get(
    '/stats',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const ownerId = requestOwnerId(request);
      const where = { bot: { ownerId } } as const;
      const [total, replayed, byType, byPlatform] = await Promise.all([
        request.prisma.eventRecord.count({ where }),
        request.prisma.eventRecord.count({ where: { bot: { ownerId }, replayCount: { gt: 0 } } }),
        request.prisma.eventRecord.groupBy({
          by: ['type'],
          where,
          _count: { id: true },
        }),
        request.prisma.eventRecord.groupBy({
          by: ['platform'],
          where,
          _count: { id: true },
        }),
      ]);
      return {
        success: true,
        data: {
          total,
          replayed,
          byType: byType.map((r) => ({ type: r.type, count: r._count.id })),
          byPlatform: byPlatform.map((r) => ({ platform: r.platform, count: r._count.id })),
        },
      };
    },
  );

  app.get('/', { config: { rateLimit: { max: 180, timeWindow: '1 minute' } } }, async (request) => {
    const ownerId = requestOwnerId(request);
    const query = request.query as Record<string, unknown>;
    const { take, skip } = parsePage(query, { limit: 100, maxLimit: 1000 });

    const where: Record<string, unknown> = { bot: { ownerId } };
    if (typeof query.botId === 'string' && query.botId.length > 0) where.botId = query.botId;
    if (typeof query.platform === 'string' && query.platform.length > 0) {
      where.platform = query.platform;
    }
    if (typeof query.type === 'string' && query.type.length > 0) where.type = query.type;

    const [events, total] = await Promise.all([
      request.prisma.eventRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      request.prisma.eventRecord.count({ where }),
    ]);
    return { success: true, data: events, total };
  });

  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const event = await request.prisma.eventRecord.findFirst({
      where: { id: request.params.id, bot: { ownerId: requestOwnerId(request) } },
    });
    if (!event) return sendNotFound(reply);
    return { success: true, data: event };
  });

  /**
   * Replays a stored event by enqueuing an `event` job on the platform's
   * queue; the worker re-emits it with `replay: true`. The contract version is
   * validated so a stored event that is now unsupported cannot be replayed
   * against a newer adapter and misinterpreted.
   */
  app.post<{ Params: { id: string } }>(
    '/:id/replay',
    { onRequest: requireAdmin },
    async (request, reply) => {
      const ownerId = requestOwnerId(request);
      const event = await request.prisma.eventRecord.findFirst({
        where: { id: request.params.id, bot: { ownerId } },
      });
      if (!event) return sendNotFound(reply);

      try {
        assertContractSupported(event.platform, event.type, event.version);
      } catch {
        return reply.status(422).send({
          success: false,
          error: {
            code: 'UNSUPPORTED_CONTRACT',
            message: `Event contract v${event.version} for ${event.platform}/${event.type} is no longer supported`,
          },
        });
      }

      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const envelope = {
        botId: event.botId,
        platform: event.platform,
        type: event.type,
        v: event.version,
        eventId: event.eventId,
        payload,
        timestamp: event.createdAt,
      };

      await enqueueEventReplay(event.platform, event.botId, envelope);
      await request.prisma.eventRecord.update({
        where: { id: event.id },
        data: { replayCount: { increment: 1 }, lastReplayedAt: new Date() },
      });
      metrics.incrementCounter('bothive_event_replays_total', { platform: event.platform });

      return { success: true, message: 'Event queued for replay' };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { onRequest: requireAdmin },
    async (request, reply) => {
      const ownerId = requestOwnerId(request);
      const existing = await request.prisma.eventRecord.findFirst({
        where: { id: request.params.id, bot: { ownerId } },
        select: { id: true },
      });
      if (!existing) return sendNotFound(reply);
      await request.prisma.eventRecord.delete({ where: { id: request.params.id } });
      return { success: true };
    },
  );
}

import type { FastifyInstance } from 'fastify';
import {
  getAllQueueMetrics,
  getFailedJobs,
  getDeadLetterJobs,
  replayDeadLetterJob,
  replayAllDeadLetterJobs,
} from '../services/queue.js';
import { requireAuth, requireAdmin } from '../utils/auth-hook.js';

export async function queueRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);

  app.get('/', { config: { rateLimit: { max: 180, timeWindow: '1 minute' } } }, async () => {
    const data = await getAllQueueMetrics();
    return { success: true, data };
  });

  // Failed job details include internal error messages — admins only.
  app.get('/failed', { onRequest: requireAdmin }, async () => {
    const data = await getFailedJobs();
    return { success: true, data };
  });

  // Dead-letter queues: jobs that exhausted their retry budget and were moved
  // out of the live queues by the workers. Admins can inspect and replay them.
  app.get('/dead-letter', { onRequest: requireAdmin }, async (request) => {
    const raw = (request.query as Record<string, unknown>).limit;
    const limit = Number.parseInt(typeof raw === 'string' ? raw : '', 10);
    const data = await getDeadLetterJobs(
      Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 20,
    );
    return { success: true, data };
  });

  app.post<{ Params: { platform: string; id: string } }>(
    '/dead-letter/:platform/:id/replay',
    { onRequest: requireAdmin },
    async (request, reply) => {
      const result = await replayDeadLetterJob(request.params.platform, request.params.id);
      if (!result.ok) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: result.reason ?? 'Dead-letter job not found' },
        });
      }
      return { success: true, message: 'Dead-letter job replayed' };
    },
  );

  app.post('/dead-letter/replay-all', { onRequest: requireAdmin }, async (request, reply) => {
    const result = await replayAllDeadLetterJobs();
    if (result.failed > 0) {
      return reply.status(502).send({
        success: false,
        error: {
          code: 'PARTIAL_REPLAY',
          message: `Replayed ${result.replayed}, failed ${result.failed}`,
        },
      });
    }
    return { success: true, data: result };
  });
}

import type { FastifyInstance } from 'fastify';
import { getAllQueueMetrics, getFailedJobs } from '../services/queue.js';
import { requireAuth, requireAdmin } from '../utils/auth-hook.js';

export async function queueRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);

  app.get('/', async () => {
    const data = await getAllQueueMetrics();
    return { success: true, data };
  });

  // Failed job details include internal error messages — admins only.
  app.get('/failed', { onRequest: requireAdmin }, async () => {
    const data = await getFailedJobs();
    return { success: true, data };
  });
}

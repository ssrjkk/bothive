import type { FastifyInstance } from 'fastify';
import { getAllQueueMetrics } from '../services/queue.js';
import { requireAuth } from '../utils/auth-hook.js';

export async function queueRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);

  app.get('/', async () => {
    const data = await getAllQueueMetrics();
    return { success: true, data };
  });
}
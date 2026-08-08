import type { FastifyInstance } from 'fastify';
import { CreateProxySchema, UpdateProxySchema, maskProxyUrl, decryptCredential, encryptCredential, testProxy } from '@bothive/core';
import { parsePage } from '../utils/query.js';
import { requireAdmin } from '../utils/auth-hook.js';

function publicProxy(proxy: {
  id: string;
  url: string;
  type: string;
  priority: number;
  enabled: boolean;
  healthScore: number;
  lastFailedAt: Date | null;
  requestsCount: number;
  failureCount: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  // The url is stored encrypted; decrypt before masking so the dashboard sees
  // the real endpoint without embedded credentials.
  const decrypted = decryptCredential(proxy.url) ?? proxy.url;
  return {
    id: proxy.id,
    url: maskProxyUrl(decrypted),
    type: proxy.type,
    priority: proxy.priority,
    enabled: proxy.enabled,
    healthScore: proxy.healthScore,
    lastFailedAt: proxy.lastFailedAt,
    requestsCount: proxy.requestsCount,
    failureCount: proxy.failureCount,
    createdAt: proxy.createdAt,
    updatedAt: proxy.updatedAt,
  };
}

export async function proxyRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAdmin);

  app.get('/', async (request) => {
    const { take, skip } = parsePage(request.query as Record<string, unknown>, { limit: 100, maxLimit: 1000 });
    const proxies = await request.prisma.proxy.findMany({ orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }], take, skip });
    return { success: true, data: proxies.map(publicProxy) };
  });

  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const proxy = await request.prisma.proxy.findUnique({ where: { id: request.params.id } });
    if (!proxy) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Proxy not found' } });
    return { success: true, data: publicProxy(proxy) };
  });

  app.post<{ Body: unknown }>('/', async (request, reply) => {
    const parsed = CreateProxySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten().fieldErrors } });
    }

    const proxy = await request.prisma.proxy.create({
      data: {
        url: encryptCredential(parsed.data.url),
        type: parsed.data.type,
        priority: parsed.data.priority,
      },
    });
    return { success: true, data: publicProxy(proxy) };
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/:id', async (request, reply) => {
    const existing = await request.prisma.proxy.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Proxy not found' } });

    const parsed = UpdateProxySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten().fieldErrors } });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.url !== undefined) data.url = encryptCredential(parsed.data.url);
    if (parsed.data.type !== undefined) data.type = parsed.data.type;
    if (parsed.data.priority !== undefined) data.priority = parsed.data.priority;
    if (parsed.data.enabled !== undefined) data.enabled = parsed.data.enabled;

    const updated = await request.prisma.proxy.update({ where: { id: request.params.id }, data });
    return { success: true, data: publicProxy(updated) };
  });

  app.post<{ Params: { id: string } }>('/:id/test', async (request, reply) => {
    const existing = await request.prisma.proxy.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Proxy not found' } });

    const url = decryptCredential(existing.url);
    if (!url) {
      return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Cannot decrypt proxy url' } });
    }

    const reachable = await testProxy(url);
    const updated = await request.prisma.proxy.update({
      where: { id: request.params.id },
      data: reachable
        ? { healthScore: 100, lastFailedAt: null }
        : { healthScore: 0, lastFailedAt: new Date() },
    });
    return { success: true, data: { ...publicProxy(updated), reachable } };
  });

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const existing = await request.prisma.proxy.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Proxy not found' } });
    await request.prisma.proxy.delete({ where: { id: request.params.id } });
    return { success: true };
  });
}

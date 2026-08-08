import type { FastifyInstance } from 'fastify';
import { CreateAccountSchema, PlatformSchema, encryptCredential } from '@bothive/core';
import { parsePage } from '../utils/query.js';
import { requireAuth } from '../utils/auth-hook.js';

const CREDENTIAL_FIELDS = ['token', 'clientId', 'secret', 'refreshToken', 'apiKey'] as const;

function flattenCredentials(credentials?: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (!credentials) return data;
  for (const field of CREDENTIAL_FIELDS) {
    const value = credentials[field];
    if (typeof value === 'string' && value.length > 0) data[field] = encryptCredential(value);
  }
  return data;
}

function collectCredentials(account: {
  token?: string | null;
  clientId?: string | null;
  secret?: string | null;
  refreshToken?: string | null;
  apiKey?: string | null;
}): Record<string, boolean> {
  const present: Record<string, boolean> = {};
  for (const field of CREDENTIAL_FIELDS) {
    const value = account[field];
    if (typeof value === 'string' && value.length > 0) present[field] = true;
  }
  return present;
}

function stripSecretFields(account: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...account };
  for (const field of CREDENTIAL_FIELDS) delete copy[field];
  return copy;
}

export async function accountRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);

  app.get('/', async (request) => {
    const { take, skip } = parsePage(request.query as Record<string, unknown>, {
      limit: 100,
      maxLimit: 1000,
    });
    const accounts = await request.prisma.account.findMany({
      include: { _count: { select: { bots: true } } },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
    return {
      success: true,
      data: accounts.map((account) => ({
        ...stripSecretFields(account),
        credentials: collectCredentials(account),
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const account = await request.prisma.account.findUnique({
      where: { id: request.params.id },
      include: { bots: { select: { id: true, name: true, platform: true, status: true } } },
    });
    if (!account)
      return reply
        .status(404)
        .send({ success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } });
    return {
      success: true,
      data: { ...stripSecretFields(account), credentials: collectCredentials(account) },
    };
  });

  app.post<{ Body: { name: string; platform: string; credentials?: Record<string, unknown> } }>(
    '/',
    async (request, reply) => {
      const parsed = CreateAccountSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            details: parsed.error.flatten().fieldErrors,
          },
        });
      }

      const account = await request.prisma.account.create({
        data: {
          name: parsed.data.name,
          platform: parsed.data.platform,
          ...flattenCredentials(parsed.data.credentials),
        },
      });
      return {
        success: true,
        data: { ...stripSecretFields(account), credentials: collectCredentials(account) },
      };
    },
  );

  app.patch<{
    Params: { id: string };
    Body: { name?: string; platform?: string; credentials?: Record<string, unknown> };
  }>('/:id', async (request, reply) => {
    const account = await request.prisma.account.findUnique({
      where: { id: request.params.id },
      include: { _count: { select: { bots: true } } },
    });
    if (!account)
      return reply
        .status(404)
        .send({ success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } });

    if (request.body.platform !== undefined) {
      const platformParsed = PlatformSchema.safeParse(request.body.platform);
      if (!platformParsed.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid platform' },
        });
      }
      if (request.body.platform !== account.platform && account._count.bots > 0) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'CONFLICT',
            message: 'Cannot change platform while the account has bots',
          },
        });
      }
    }

    const data: Record<string, unknown> = {};
    if (request.body.name !== undefined) {
      if (
        typeof request.body.name !== 'string' ||
        request.body.name.trim().length === 0 ||
        request.body.name.length > 100
      ) {
        return reply.status(422).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'name must be a non-empty string of at most 100 characters',
          },
        });
      }
      data.name = request.body.name.trim();
    }
    if (request.body.platform !== undefined) data.platform = request.body.platform;
    if (request.body.credentials) {
      Object.assign(data, flattenCredentials(request.body.credentials));
    }

    const updated = await request.prisma.account.update({ where: { id: request.params.id }, data });
    return {
      success: true,
      data: { ...stripSecretFields(updated), credentials: collectCredentials(updated) },
    };
  });

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const account = await request.prisma.account.findUnique({
      where: { id: request.params.id },
      include: { _count: { select: { bots: true } } },
    });
    if (!account)
      return reply
        .status(404)
        .send({ success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } });
    if (account._count.bots > 0) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'CONFLICT',
          message: `Account has ${account._count.bots} bot(s); delete or reassign them first`,
        },
      });
    }

    await request.prisma.account.delete({ where: { id: request.params.id } });
    return { success: true };
  });
}

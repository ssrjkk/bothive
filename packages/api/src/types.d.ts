import 'fastify';
import { PrismaClient } from '@prisma/client';

declare module 'fastify' {
  interface FastifyRequest {
    prisma: PrismaClient;
    metricsStart?: bigint;
  }
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

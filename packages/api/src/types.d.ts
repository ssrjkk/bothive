import 'fastify';
import { PrismaClient } from '../prisma/generated/prisma/client.js';

declare module 'fastify' {
  interface FastifyRequest {
    prisma: PrismaClient;
    metricsStart?: bigint;
  }
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

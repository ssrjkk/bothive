import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'packages/api/prisma/schema.prisma',
  migrations: {
    path: 'packages/api/prisma/migrations',
    seed: 'tsx packages/api/prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});

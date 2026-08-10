FROM node:25-alpine AS build
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json prisma.config.ts ./
COPY scripts ./scripts
COPY packages ./packages
RUN --mount=type=cache,target=/root/.npm npm ci
RUN node scripts/db-generate.mjs
RUN npm run build

FROM node:25-alpine AS api
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json tsconfig.base.json prisma.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/api ./packages/api
COPY --from=build /app/packages/core ./packages/core
WORKDIR /app/packages/api
# Run as the unprivileged `node` user. Migrations need write access to the
# (already generated) Prisma client, so hand /app to the app user.
RUN chown -R node:node /app
USER node
EXPOSE 3000
# Keep the process level with the container so `docker run` without compose gets
# a healthcheck too (compose overrides this with its own probe).
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=10s CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "/app/node_modules/.bin/prisma migrate deploy --config /app/prisma.config.ts && node --import dist/tracing-preload.js dist/index.js"]

FROM node:25-alpine AS workers
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json tsconfig.base.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/workers ./packages/workers
COPY --from=build /app/packages/core ./packages/core
# The generated Prisma client lives under packages/api; give the workers image
# just that subtree so the compiled imports resolve at runtime.
COPY --from=build /app/packages/api/prisma/generated ./packages/api/prisma/generated
WORKDIR /app/packages/workers
RUN chown -R node:node /app
USER node
# The worker has no HTTP listener; probe its critical dependency (Redis) from
# its own process (packages/workers/healthcheck.cjs).
HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=10s CMD node /app/packages/workers/healthcheck.cjs
CMD ["node", "--import", "dist/tracing-preload.js", "dist/index.js"]

FROM nginx:alpine AS dashboard
COPY packages/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/dashboard/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

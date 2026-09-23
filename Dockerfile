# Base images are pinned by digest so a rebuild resolves to the same layers every
# time. A floating tag silently swaps the base underneath us and can reintroduce
# OS packages we already patched. Dependabot (.github/dependabot.yml, `docker`
# ecosystem) opens a PR when a pinned digest moves, so the pins do not rot.
FROM node:26-alpine@sha256:dbaa92e5758cbbcf85d65d5403fdb530fe3442cbe8c6dbfb7ef23365450d5070 AS build
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json prisma.config.ts ./
COPY scripts ./scripts
COPY packages ./packages
RUN --mount=type=cache,target=/root/.npm npm ci
RUN node scripts/db-generate.mjs
RUN npm run build

FROM node:26-alpine@sha256:dbaa92e5758cbbcf85d65d5403fdb530fe3442cbe8c6dbfb7ef23365450d5070 AS api
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NODE_ENV=production
# Version reported to Sentry and in worker heartbeats. These images launch
# `node` directly (npm is removed below), so npm_package_version is unavailable
# at runtime and every service would otherwise report "dev". The release
# workflow passes the git tag here; local builds default to "dev".
ARG SERVICE_VERSION=dev
ENV SERVICE_VERSION=$SERVICE_VERSION
# Runtime image must not contain the build toolchain (typescript/tsx/vite/
# esbuild and their Go binaries, or the unpatched transitive packages they
# dragged in: tar, brace-expansion, picomatch, sigstore, ip-address). Install
# production deps for this image's workspaces only — scoping with `--workspace`
# keeps the dashboard's browser deps (antd, react, recharts and the whole d3
# tree) out of a server image. `--ignore-scripts` because the Prisma client is
# generated at build time and copied in below.
COPY package.json package-lock.json tsconfig.base.json prisma.config.ts ./
COPY packages/api/package.json packages/api/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/dashboard/package.json packages/dashboard/package.json
COPY packages/workers/package.json packages/workers/package.json
# Hand /app to the app user *before* installing, so the install runs as that
# user and everything it writes is already owned correctly. This is the cheap
# moment to chown: /app holds nothing but a few manifests here. Chowning after
# the install (what this image used to do) rewrites node_modules into a second
# layer and roughly doubles the image.
RUN chown -R node:node /app
USER node
RUN --mount=type=cache,target=/home/node/.npm,uid=1000 npm ci --omit=dev --ignore-scripts --no-audit --no-fund --workspace @bothive/api --workspace @bothive/core
# The app runs plain `node`; drop the base image's bundled npm/yarn so Trivy
# stops flagging vulnerabilities inside /usr/local/lib/node_modules/npm.
USER root
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER node
# Copy built output only. Pulling in whole package directories would drag the
# build stage's node_modules — and with it the dev-only toolchain — along.
COPY --chown=node:node --from=build /app/packages/api/dist ./packages/api/dist
COPY --chown=node:node --from=build /app/packages/api/package.json ./packages/api/package.json
# prisma/ carries the migrations `migrate deploy` runs and the generated client.
COPY --chown=node:node --from=build /app/packages/api/prisma ./packages/api/prisma
COPY --chown=node:node --from=build /app/packages/core/dist ./packages/core/dist
COPY --chown=node:node --from=build /app/packages/core/package.json ./packages/core/package.json
WORKDIR /app/packages/api
EXPOSE 3000
# Keep the process level with the container so `docker run` without compose gets
# a healthcheck too (compose overrides this with its own probe).
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=10s CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "/app/node_modules/.bin/prisma migrate deploy --config /app/prisma.config.ts && node --import ./dist/tracing-preload.js ./dist/index.js"]

FROM node:26-alpine@sha256:dbaa92e5758cbbcf85d65d5403fdb530fe3442cbe8c6dbfb7ef23365450d5070 AS workers
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NODE_ENV=production
# Version reported to Sentry and in worker heartbeats (see the api stage note).
ARG SERVICE_VERSION=dev
ENV SERVICE_VERSION=$SERVICE_VERSION
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/dashboard/package.json packages/dashboard/package.json
COPY packages/workers/package.json packages/workers/package.json
# Production deps of the workers and their core dependency only, same rationale
# as the api stage. Chown before installing so the install runs as the app user.
RUN chown -R node:node /app
USER node
RUN --mount=type=cache,target=/home/node/.npm,uid=1000 npm ci --omit=dev --ignore-scripts --no-audit --no-fund --workspace @bothive/workers --workspace @bothive/core
# The workers also run plain `node`; drop the base image's bundled npm/yarn.
USER root
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER node
COPY --chown=node:node --from=build /app/packages/workers/dist ./packages/workers/dist
COPY --chown=node:node --from=build /app/packages/workers/package.json ./packages/workers/package.json
COPY --chown=node:node --from=build /app/packages/workers/healthcheck.cjs ./packages/workers/healthcheck.cjs
COPY --chown=node:node --from=build /app/packages/core/dist ./packages/core/dist
COPY --chown=node:node --from=build /app/packages/core/package.json ./packages/core/package.json
# The generated Prisma client lives under packages/api, and the compiled workers
# import it by relative path (`../../api/prisma/generated/prisma/client.js`), so
# give the workers image just that subtree.
COPY --chown=node:node --from=build /app/packages/api/prisma/generated ./packages/api/prisma/generated
WORKDIR /app/packages/workers
# The worker has no HTTP listener; probe its critical dependency (Redis) from
# its own process (packages/workers/healthcheck.cjs).
HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=10s CMD node /app/packages/workers/healthcheck.cjs
CMD ["node", "--import", "./dist/tracing-preload.js", "./dist/index.js"]

FROM nginx:alpine@sha256:62ff2089abf5a9ed33bd232895bef5e22f7bb4b200675cec49a5ebc48e3d4ac8 AS dashboard
COPY packages/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/dashboard/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

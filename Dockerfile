FROM node:20-alpine AS build
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
RUN npm ci
RUN ./node_modules/.bin/prisma generate --schema packages/api/prisma/schema.prisma
RUN npm run build

FROM node:20-alpine AS api
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json tsconfig.base.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/api ./packages/api
COPY --from=build /app/packages/core ./packages/core
WORKDIR /app/packages/api
# Run as the unprivileged `node` user. Migrations need write access to the
# (already generated) Prisma client, so hand /app to the app user.
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["sh", "-c", "/app/node_modules/.bin/prisma migrate deploy --schema /app/packages/api/prisma/schema.prisma && node dist/index.js"]

FROM node:20-alpine AS workers
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json tsconfig.base.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/workers ./packages/workers
COPY --from=build /app/packages/core ./packages/core
WORKDIR /app/packages/workers
RUN chown -R node:node /app
USER node
CMD ["node", "dist/index.js"]

FROM nginx:alpine AS dashboard
COPY packages/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/dashboard/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

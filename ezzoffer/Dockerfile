FROM node:24-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:24-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN useradd -m -r appuser

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/scripts ./scripts

# Динамический доступ к файловой системе (путь к SQLite и к TTF-шрифту
# вычисляется в рантайме) заставляет Turbopack включить в .next/standalone весь
# проект. Локальные данные — единственное, что здесь опасно: ezoffer.db с
# хэшами паролей и OAuth-токенами. Данные приходят только из volume, поэтому
# содержимое /app/data не важно, а исходники и тесты просто не нужны в образе.
# deploy-out/pages-out вычищаются по той же причине, что и data: Turbopack
# разворачивает в standalone весь проект, до которого дотягивается трассировка,
# а предыдущий deploy-out содержит data/ezoffer.db внутри себя. Поэтому `rm -rf
# /app/data` недостаточно: база лежит не там, а на уровень глубже, и имя
# каталога при следующей сборке может измениться. После удаления — проверка
# остатка, чтобы пропуск нельзя было не заметить: образ уедет на сервер.
RUN rm -rf /app/data ./src ./tests ./deploy-out ./pages-out \
 && mkdir -p /app/data \
 && chown -R appuser:appuser /app/data \
 && if find /app -name 'ezoffer.db*' -print -quit | grep -q .; then \
      echo 'В образе осталась база данных — сборка прервана'; \
      find /app -name 'ezoffer.db*' -exec ls -l {} \; ; \
      exit 1; \
    fi

# Шрифт с кириллицей для PDF-экспорта. Копируется явно: outputFileTracingIncludes
# не годится — он разворачивает в трассировку весь проект целиком.
RUN mkdir -p /app/node_modules/dejavu-fonts-ttf/ttf \
 && cp /app/node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf /app/node_modules/dejavu-fonts-ttf/ttf/DejaVuSansCondensed.ttf \
    /app/node_modules/dejavu-fonts-ttf/ttf/ \
 && chown -R appuser:appuser /app/node_modules/dejavu-fonts-ttf

USER appuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
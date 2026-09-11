# Kubernetes deployment

Step-by-step guide for running BotHive on Kubernetes. The compose stack is the
reference topology ([docs/deployment.md](deployment.md)); this guide maps each
service to a Kubernetes object. It assumes a cluster with an ingress controller
(nginx-ingress) and a way to provide Postgres and Redis — managed services
(RDS, ElastiCache, Cloud SQL, Upstash…) are recommended over running stateful
pods.

## Architecture mapping

| Compose service          | Kubernetes object                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `postgres`               | managed PostgreSQL (or StatefulSet + PVC)                                                            |
| `redis`                  | managed Redis (or StatefulSet + PVC)                                                                 |
| `api`                    | Deployment `api` (1+ replicas, read-write)                                                           |
| `workers-<platform>` ×4  | Deployment per platform (`workers-telegram`, `workers-twitch`, `workers-youtube`, `workers-twitter`) |
| `dashboard`              | Deployment `dashboard` + Service + Ingress                                                           |
| `prometheus` / `grafana` | Prometheus Operator (see [docs/slo.md](slo.md))                                                      |

The API runs `prisma migrate deploy` on startup (`Dockerfile`), so it is
idempotent — but concurrent pod starts can race each other. For a clean rollout,
run migrations as a one-shot **Job** first, then deploy the API with
`initContainers` or a rollout order that waits for the Job.

## 1. Namespace and secrets

```bash
kubectl create namespace bothive
```

```yaml
# secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: bothive
  namespace: bothive
type: Opaque
stringData:
  JWT_SECRET: '<random 32+ bytes>'
  ENCRYPTION_KEY: '<random 64 hex chars — see .env.example>'
  PASSWORD_PEPPER: '<long random string>'
  METRICS_TOKEN: '<strong random token for /metrics>'
  DATABASE_URL: 'postgresql://bothive:pass@<host>:5432/bothive?connection_limit=10'
  REDIS_URL: 'redis://<host>:6379'
  REDIS_PASSWORD: '' # set when Redis requires auth
```

> `ENCRYPTION_KEY` is permanent for the lifetime of the stored credentials —
> rotating it makes existing credentials undecryptable. See
> [docs/security.md](security.md#key-rotation).

## 2. Migrations

```bash
kubectl apply -f - <<'EOF'
apiVersion: batch/v1
kind: Job
metadata:
  name: bothive-migrate
  namespace: bothive
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: ssrjkk/bothive-api:latest
          command: ["npx", "prisma", "migrate", "deploy", "--config", "/app/prisma.config.ts"]
          envFrom:
            - secretRef:
                name: bothive
EOF
kubectl wait --for=condition=complete job/bothive-migrate -n bothive --timeout=300s
```

Each API pod also runs `migrate deploy` on start as a safety net, so an
accidental direct rollout still converges.

## 3. API

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: bothive
spec:
  replicas: 2
  selector:
    matchLabels: { app: bothive-api }
  template:
    metadata:
      labels: { app: bothive-api }
    spec:
      containers:
        - name: api
          image: ssrjkk/bothive-api:latest
          ports:
            - { containerPort: 3000, name: http }
          envFrom:
            - secretRef: { name: bothive }
          env:
            - { name: API_PORT, value: '3000' }
            - { name: LOG_LEVEL, value: 'info' }
            - { name: TRUST_PROXY, value: 'true' }
            - { name: EXPOSE_ERROR_STACK, value: 'false' }
            - { name: API_HTTP2, value: 'false' }
            # Optional tracing — see docs/tracing.md
            - { name: OTEL_EXPORTER_OTLP_ENDPOINT, value: 'http://otel-collector:4318' }
          resources:
            requests: { cpu: 250m, memory: 256Mi }
            limits: { cpu: '1', memory: 512Mi }
          readinessProbe:
            httpGet: { path: /health/ready, port: http }
            periodSeconds: 10
            failureThreshold: 3
          livenessProbe:
            httpGet: { path: /health, port: http }
            periodSeconds: 15
            failureThreshold: 3
```

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: bothive
spec:
  selector: { app: bothive-api }
  ports:
    - { port: 3000, targetPort: http }
```

`/health/ready` probes **both** Postgres and Redis (503 when either is down),
so a failing dependency drains the pod from the Service — the workers keep
their jobs in Redis and resume when it returns.

## 4. Workers (one deployment per platform)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: workers-telegram
  namespace: bothive
spec:
  # >1 replicas is supported: the per-platform leader election (ADR-0002)
  # guarantees singleton jobs run exactly once; other replicas stay paused.
  replicas: 2
  selector:
    matchLabels: { app: bothive-workers, platform: telegram }
  template:
    metadata:
      labels: { app: bothive-workers, platform: telegram }
    spec:
      containers:
        - name: worker
          image: ssrjkk/bothive-workers:latest
          command:
            - node
            - --import
            - ./dist/tracing-preload.js
            - ./dist/index.js
            - --platform
            - telegram
          envFrom:
            - secretRef: { name: bothive }
          env:
            - { name: WORKER_CONCURRENCY, value: '10' }
            # Keep the heap inside the container memory limit (same rule as
            # compose: docs/capacity-planning.md).
            - { name: NODE_OPTIONS, value: '--max-old-space-size=512' }
          resources:
            requests: { cpu: 250m, memory: 512Mi }
            limits: { cpu: '1', memory: 768Mi }
          readinessProbe:
            # The worker has no HTTP listener; probe Redis reachability from
            # inside the process (packages/workers/healthcheck.cjs).
            exec:
              command: ['node', '/app/packages/workers/healthcheck.cjs']
            periodSeconds: 15
            failureThreshold: 3
          livenessProbe:
            exec:
              command: ['node', '/app/packages/workers/healthcheck.cjs']
            periodSeconds: 30
            failureThreshold: 3
```

Repeat for `twitch`, `youtube`, `twitter` (change the `--platform` argument,
labels and names). One process per platform keeps fault isolation: a crash in
one platform never takes down the others.

## 5. Dashboard

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dashboard
  namespace: bothive
spec:
  replicas: 1
  selector:
    matchLabels: { app: bothive-dashboard }
  template:
    metadata:
      labels: { app: bothive-dashboard }
    spec:
      containers:
        - name: dashboard
          image: ssrjkk/bothive-dashboard:latest
          ports:
            - { containerPort: 80, name: http }
          resources:
            requests: { cpu: 50m, memory: 64Mi }
            limits: { cpu: 250m, memory: 128Mi }
```

```yaml
apiVersion: v1
kind: Service
metadata:
  name: dashboard
  namespace: bothive
spec:
  selector: { app: bothive-dashboard }
  ports:
    - { port: 80, targetPort: http }
```

The dashboard nginx proxies `/api/` to the `api` Service — add a Service entry
for it inside the nginx config (`proxy_pass http://api:3000;` is already what
the container expects; in-cluster DNS resolves `api` to the API Service). For a
managed Ingress you usually route `/api/`, `/ws/` and `/health` straight to the
`api` Service instead and let the dashboard serve only the SPA.

## 6. Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: bothive
  namespace: bothive
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: '3600' # WebSocket log stream
    nginx.ingress.kubernetes.io/proxy-send-timeout: '3600'
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  ingressClassName: nginx
  tls:
    - hosts: [bot.example.com]
      secretName: bothive-tls
  rules:
    - host: bot.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend: { service: { name: api, port: { number: 3000 } } }
          - path: /ws
            pathType: Prefix
            backend: { service: { name: api, port: { number: 3000 } } }
          - path: /
            pathType: Prefix
            backend: { service: { name: dashboard, port: { number: 80 } } }
```

Because the Ingress terminates TLS, keep `TRUST_PROXY=true` on the API (set
above) so `request.ip` honors `X-Forwarded-For` for correct rate limiting and
audit logs. Do not set it when the API is exposed directly.

## 7. Scaling and upgrades

- **Workers**: scale per platform with `kubectl scale deploy workers-telegram --replicas=3` or an HPA on CPU/memory. Raise `WORKER_CONCURRENCY` per process instead of (or in addition to) more replicas. The leader election makes >1 replica safe; each replica publishes its own heartbeat and shows up in `GET /api/health/workers`.
- **API**: stateless and horizontally scalable. Keep `DATABASE_URL`'s `connection_limit` per pod so the fleet cannot exhaust Postgres connections (same reasoning as the compose anchor in `docker-compose.yml`).
- **Rolling updates**: use `strategy: RollingUpdate` (default) with `maxUnavailable: 0` for the API, or rely on the readiness probe draining pods during rollout. Migrations run as a Job first; the API's startup `migrate deploy` is the fallback.
- **Backups**: point `docs/backup.md`'s `pg_dump`/Redis snapshot procedure at the managed services, or back up the DB service directly.

## 8. Observability

- **Metrics**: the API exposes `GET /metrics` (Bearer `METRICS_TOKEN`). Annotate the API pods for Prometheus scraping (`prometheus.io/scrape: "true"`, port `3000`, path `/metrics`), or scrape the Service directly. The alert rules in `prometheus/rules/bothive.yml` and Grafana dashboards (`grafana/dashboards/bothive.json`) are ready to import.
- **Tracing**: set `OTEL_EXPORTER_OTLP_ENDPOINT` (API and workers) and deploy an OTLP collector — see [docs/tracing.md](tracing.md).
- **Logs**: `kubectl logs -n bothive deploy/api` etc.; workers log per platform deployment.

# Contributing to BotHive

Thanks for wanting to help! BotHive is a monorepo (TypeScript, Node ≥ 20) with four packages:

| Package | What lives there |
|---|---|
| `packages/core` | domain logic, validation, credential cipher, rate limiters, webhook signing, script config safety |
| `packages/api` | Fastify HTTP API, JWT auth + RBAC, BullMQ enqueuing, Prisma schema/migrations |
| `packages/workers` | BullMQ consumers, platform adapters, script engine, webhook dispatcher |
| `packages/dashboard` | React + antd admin panel |

## Getting started

```bash
npm install
docker compose up -d postgres redis   # infra only
npx prisma migrate deploy             # from packages/api
npm run dev                           # api + workers + dashboard
```

## Checks

Run all three before opening a PR:

```bash
npm run build   # TypeScript across all workspaces
npm run lint
npm test        # vitest
```

Tests live next to the code (`*.test.ts`) and use mocked DB/queue/Redis, so they run without a database.

## What we look for

- **Safety first.** BotHive is a security-sensitive codebase: script sandboxes, SSRF guards, credential encryption and RBAC. Any change in those areas needs tests proving the unsafe case is blocked.
- **No credential leakage.** The API must never serialize account tokens, HMAC secrets or password hashes — keep tests asserting that.
- **Follow existing patterns.** Look at a neighbouring route/handler before writing a new one (validation via `@bothive/core` zod schemas, `Result`-style returns, `requireAuth`/`requireAdmin` hooks).
- **Keep the dashboard accessible.** antd components, theme-aware (light/dark) colors via tokens — avoid hardcoded hex where a token exists.

## Commit & PR

- Keep commits small and focused; the repo uses conventional-style summaries (`feat:`, `fix:`, `docs:`, `perf:`, `chore:`).
- In the PR description, explain **what** changed, **why**, and how it was verified (tests run + build/lint pass).
- If you add or change an API endpoint, update `docs/api.md` and the README API surface.

## Questions

Open an issue before a large PR — it helps to agree on the shape of the change first.

# ADR-0001: Prisma 7 config-driven client, compiled to JS

- **Status:** Accepted
- **Date:** 2026-08
- **Deciders:** maintainer

## Context

The data layer uses Prisma. Prisma 7 moved to a config-driven CLI (`prisma.config.ts`) and the `prisma-client` generator emits TypeScript sources (module `esm`, output `packages/api/prisma/generated/prisma`) instead of a prebuilt JS bundle. `prisma generate --schema ...` (the Prisma ≤6 CLI form) is gone, and the client no longer ships engine binaries that need a separate `node_modules/.prisma` cache.

The generated output must be consumable at runtime by `@bothive/api` (ESM, NodeNext) via `import { PrismaClient } from '../prisma/generated/prisma/client.js'` — a real `.js` file — and by the workers package, which imports the same generated package.

## Decision

- Centralize schema/config in `prisma.config.ts` at the repo root (schema path, migrations path, seed command, datasource URL).
- Generate the client with plain `npx prisma generate` (config-driven; no `--schema` flag) and compile the emitted TypeScript to JavaScript with `tsc -p packages/api/tsconfig.prisma.json` into `packages/api/prisma/generated/prisma`.
- Wrap both steps in the root script `db:generate` (`scripts/db-generate.mjs`), which also strips leftover `.ts` sources, keeps `.d.ts` files, and fails if `client.js`/`client.d.ts` are missing.
- Commit the compiled client to the repo so `npm ci` + `npm run build` works without a prior generate step.
- In CI, replace the obsolete `npx prisma generate --schema ...` step with `npm run db:generate` and drop the engine cache (`node_modules/.prisma` no longer exists).

## Consequences

- **Positive:** single config source of truth; no engine binary caching in CI; build is reproducible from a clean checkout; import path is stable ESM.
- **Negative:** generated client is compiled with a repo-local `tsc` step (adds ~seconds to setup); generated files must be kept in sync with `schema.prisma` by rerunning `db:generate`.
- **Risk:** editing `schema.prisma` and forgetting `db:generate` produces a stale client; the root `check` script does not regenerate, so CI must always run `db:generate` before `build`.

## Alternatives considered

- `prisma generate --schema packages/api/prisma/schema.prisma` — removed in Prisma 7; breaks CI.
- Bundling `@prisma/client` classic client — rejected: Prisma 7 defaults to the new `prisma-client` generator; staying on the default reduces migration cost.

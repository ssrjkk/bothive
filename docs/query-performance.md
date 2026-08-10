# Query performance

How to find and fix slow Postgres queries in BotHive. The stack ships with
`pg_stat_statements` enabled, so you can answer "what is slow right now?" from
SQL instead of guessing.

## pg_stat_statements

The `postgres` service in `docker-compose.yml` starts with:

- `shared_preload_libraries=pg_stat_statements` (must be set before the server
  starts, hence on the command line rather than an env var)
- `pg_stat_statements.track=all` — tracks every statement, including stored
  procedures/functions and prepared statements
- `track_io_timing=on` — lets `pg_stat_statements` report real block read/write
  times, which is what exposes missing indexes

Connect and look at the top queries by total time:

```bash
docker compose exec postgres psql -U postgres -d bothive
```

```sql
-- Worst overall by cumulative time
SELECT calls,
       round(total_exec_time::numeric / 1000, 1) AS total_ms,
       round(mean_exec_time::numeric, 1)          AS mean_ms,
       round(max_exec_time::numeric, 1)           AS max_ms,
       rows,
       left(query, 90)                            AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

```sql
-- Queries that keep growing (top by max execution time — the ones that spike)
SELECT round(max_exec_time::numeric, 1) AS max_ms,
       calls,
       round(mean_exec_time::numeric, 1) AS mean_ms,
       left(query, 90)                   AS query
FROM pg_stat_statements
ORDER BY max_exec_time DESC
LIMIT 20;
```

```sql
-- Queries doing the most I/O per execution (classic missing-index symptom)
SELECT round(blk_read_time::numeric, 1) AS read_ms,
       round(blk_write_time::numeric, 1) AS write_ms,
       calls,
       round(mean_exec_time::numeric, 1) AS mean_ms,
       left(query, 90)                   AS query
FROM pg_stat_statements
ORDER BY (blk_read_time + blk_write_time) DESC
LIMIT 20;
```

`pg_stat_statements` aggregates since server start. To get a clean slate (e.g.
after a deploy, so you only see the new traffic):

```sql
SELECT pg_stat_statements_reset();
```

Reset is a superuser operation; the `postgres` user in compose is a superuser.
If `pg_stat_statements` is missing, the container was started before this
setting existed — recreate it:

```bash
docker compose up -d --force-recreate postgres
```

Since the review, compose also mounts `docker/postgres-init` into
`/docker-entrypoint-initdb.d`, so **fresh** `pgdata` volumes run
`CREATE EXTENSION IF NOT EXISTS pg_stat_statements` automatically on first
start (the extension still requires `shared_preload_libraries`, which is set
via the command line). If you have an existing volume you want to fix
in-place instead of recreating, run once:

```bash
docker compose exec postgres psql -U postgres -d bothive -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
```

## The EXPLAIN workflow

1. Pick the slow query from `pg_stat_statements` and run `EXPLAIN ANALYZE` on
   it with real bind values (Prisma uses `$1` placeholders — substitute the
   actual values from `calls`/`rows` above).

   ```sql
   EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM "Log" WHERE "botId" = 'b1' ORDER BY "createdAt" DESC LIMIT 50;
   ```

2. Read the plan bottom-up. Look for:
   - `Seq Scan` on a table that grows without bound (Log is the usual suspect —
     it should always hit the `(botId, createdAt)` index).
   - `Sort` above a scan: an index with the right leading column removes it.
   - `Nested Loop` with a huge `actual rows` vs `rows` estimate — usually a
     stale `ANALYZE` or a correlated filter Prisma pushed down.
   - `Buffers: shared hit/read` — `read` means the planner could not use an
     index; `hit` means data was already cached.
3. Confirm the planner used the index you expect. If a better index exists, add
   it to `packages/api/prisma/schema.prisma` as a `@@index(...)`, then:

   ```bash
   npx prisma migrate dev --name add_slow_query_index   # from packages/api
   ```

4. Re-run `EXPLAIN ANALYZE` and watch the planner cost and `actual time` drop.

## Known hot paths and their indexes

| Query pattern                                | Index (already in schema)     |
| -------------------------------------------- | ----------------------------- |
| Bot log by bot + time window                 | `@@index([botId, createdAt])` |
| Bot list filtered by platform/status         | `@@index([platform, status])` |
| Script lookup per bot+trigger on every event | `@@index([botId, trigger])`   |
| Proxy pool by enabled                        | `@@index([enabled])`          |

The `Log` table grows with every platform event and heartbeat log line, so it
is the first place a slow-down shows up. If `pg_stat_statements` starts
reporting `Seq Scan` on `Log` with high `blk_read_time`, either an index was
dropped in a migration or the query planner is being given values that cannot
use it. `docs/backup.md` covers retention; the dashboard keeps log reads scoped
by `botId` and time range specifically so they stay index-backed.

## Analyzing a plan for Prisma-generated SQL

Prisma composes queries at runtime, so the exact text in
`pg_stat_statements` (with `$1` placeholders) may not match your migration SQL.
Two ways to get the literal query:

1. Enable query logging:
   ```bash
   DEBUG=prisma:query npm run dev
   ```
   Every Prisma statement is printed as executed, ready to paste into
   `EXPLAIN ANALYZE` after substituting real values.
2. Use `\d+ "TableName"` in psql to inspect the table + indexes, then write the
   EXPLAIN by hand against the `pg_stat_statements` template.

## When to worry

- Mean time growing on a query that used to be fast, with no volume change —
  usually index drift or a table that outgrew the planner's stats.
- `blk_read_time` dominating total time — the working set no longer fits in
  `shared_buffers` (`docs/capacity-planning.md`).
- The same query appears with wildly different `mean_exec_time` — check for
  parameter sniffing (one bot with a huge `Log` history vs a new bot); this is
  where a composite index helps the most.

-- pg_stat_statements: per-query execution stats for slow-query triage
-- (docs/query-performance.md). The library is preloaded via
-- shared_preload_libraries in docker-compose.yml; this runs on FRESH volumes
-- only (docker-entrypoint-initdb.d scripts are executed once at first init).
-- Existing volumes need a one-off:
--   docker compose exec postgres psql -U postgres -d bothive \
--     -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements;'
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

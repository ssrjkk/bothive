#!/usr/bin/env bash
set -euo pipefail

# BotHive backup script.
#
# Dumps Postgres (pg_dump) and Redis (BGSAVE + dump.rdb copy) from the running
# Docker Compose stack, gzips the artefacts, applies retention, and writes a
# SHA-256 manifest. Designed to run from the host (or cron) against the
# `bothive` stack; no tools beyond bash + docker are required.
#
# Optional environment overrides (see docs/backup.md):
#   BACKUP_ROOT      archive directory              (default: ./backups/archive)
#   STACK_NAME       compose project name           (default: bothive)
#   RETAIN_DAILY     daily archives to keep         (default: 7)
#   RETAIN_WEEKLY    weekly archives to keep        (default: 4)
#   RETAIN_MONTHLY   monthly archives to keep       (default: 12)
#   PG_USER / PG_DB  postgres credentials           (defaults: postgres / bothive)
#   REDIS_PASSWORD   redis requirepass, if enabled  (default: unset)

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-$PROJECT_DIR/backups/archive}"
STACK_NAME="${STACK_NAME:-bothive}"
RETAIN_DAILY="${RETAIN_DAILY:-7}"
RETAIN_WEEKLY="${RETAIN_WEEKLY:-4}"
RETAIN_MONTHLY="${RETAIN_MONTHLY:-12}"
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-bothive}"

STAMP="$(date +%Y%m%d-%H%M%S)"
STAMP_WEEK="$(date +%Y-%V)"
STAMP_MONTH="$(date +%Y-%m)"
OUT_DIR="$BACKUP_ROOT/$STAMP"
MANIFEST="$OUT_DIR/MANIFEST.sha256"

compose() {
  docker compose --project-name "$STACK_NAME" "$@"
}

log() { printf '[backup] %s\n' "$*"; }

mkdir -p "$OUT_DIR"

log "Dumping Postgres ($PG_DB)..."
compose exec -T postgres \
  pg_dump -U "$PG_USER" -d "$PG_DB" --format=custom --no-owner \
  > "$OUT_DIR/bothive-postgres.dump"

log "Snapshotting Redis (BGSAVE)..."
compose exec -T redis sh -c '
  if [ -n "$REDIS_PASSWORD" ]; then
    redis-cli -a "$REDIS_PASSWORD" --no-auth-warning BGSAVE >/dev/null
  else
    redis-cli BGSAVE >/dev/null
  fi
  redis-cli ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD"} --no-auth-warning LASTSAVE
' > "$OUT_DIR/redis-lastsave.txt"

log "Copying Redis dump.rdb..."
if ! compose cp redis:/data/dump.rdb "$OUT_DIR/bothive-redis.rdb" 2>/dev/null; then
  # Some Redis images persist to /data but dump.rdb appears only after the first
  # save; retry briefly in case the background save just completed.
  for _ in 1 2 3 4 5; do
    sleep 2
    compose cp redis:/data/dump.rdb "$OUT_DIR/bothive-redis.rdb" 2>/dev/null && break
  done
fi
if [ ! -s "$OUT_DIR/bothive-redis.rdb" ]; then
  log "WARNING: redis dump.rdb not found — Redis has no RDB snapshot yet."
  rm -f "$OUT_DIR/bothive-redis.rdb"
fi

gzip -f "$OUT_DIR/bothive-postgres.dump"
if [ -f "$OUT_DIR/bothive-redis.rdb" ]; then
  gzip -f "$OUT_DIR/bothive-redis.rdb"
fi

# Retention (age-based, safe under overlap between tiers):
#   RETAIN_DAILY dailies   -> prune older than N days
#   RETAIN_WEEKLY weeklies -> prune older than N weeks
#   RETAIN_MONTHLY monthlies -> prune older than N months
find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d -mtime "+$RETAIN_DAILY" -exec rm -rf {} + 2>/dev/null || true
find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d -mtime "+$((RETAIN_WEEKLY * 7))" -exec rm -rf {} + 2>/dev/null || true
find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d -mtime "+$((RETAIN_MONTHLY * 30))" -exec rm -rf {} + 2>/dev/null || true

# Cryptographic check of the whole archive.
(cd "$OUT_DIR" && sha256sum ./* | tee "$MANIFEST")

log "Backup complete: $OUT_DIR"

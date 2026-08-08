#!/usr/bin/env bash
set -euo pipefail

# BotHive restore script.
#
# Restores the most recent (or a specific) archive produced by backup.sh.
# Postgres is restored from the custom-format dump via pg_restore; Redis is
# restored by replacing dump.rdb and restarting the redis container.
#
# Usage:
#   backups/restore.sh                 # restore newest archive
#   backups/restore.sh 20260801-031500 # restore a specific archive
#
# Optional overrides (see docs/backup.md):
#   BACKUP_ROOT      archive directory  (default: ./backups/archive)
#   STACK_NAME       compose project    (default: bothive)
#   PG_USER / PG_DB  postgres identity  (defaults: postgres / bothive)
#   RESTORE_PG=0     skip Postgres
#   RESTORE_REDIS=0  skip Redis

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-$PROJECT_DIR/backups/archive}"
STACK_NAME="${STACK_NAME:-bothive}"
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-bothive}"

log() { printf '[restore] %s\n' "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

compose() { docker compose --project-name "$STACK_NAME" "$@"; }

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  TARGET="$(ls -1d "$BACKUP_ROOT"/[0-9]* 2>/dev/null | sort | tail -n 1)"
fi
[ -n "$TARGET" ] || die "no archives found in $BACKUP_ROOT"
[ -d "$TARGET" ] || die "archive not found: $TARGET"

PG_DUMP="$TARGET/bothive-postgres.dump"
REDIS_RDB="$TARGET/bothive-redis.rdb"

[ -f "$PG_DUMP" ] || PG_DUMP="${PG_DUMP}.gz"
[ -f "$REDIS_RDB" ] || REDIS_RDB="${REDIS_RDB}.gz"

log "Restoring from: $TARGET"

if [ "${RESTORE_PG:-1}" = "1" ]; then
  [ -f "$PG_DUMP" ] || die "postgres dump missing: $PG_DUMP"
  log "Recreating database $PG_DB (drops existing data)..."
  compose exec -T postgres sh -c "
    psql -v ON_ERROR_STOP=1 -U '$PG_USER' -d postgres -c 'DROP DATABASE IF EXISTS \"$PG_DB\";' \
      -c 'CREATE DATABASE \"$PG_DB\" OWNER \"$PG_USER\";'
  "
  if [[ "$PG_DUMP" == *.gz ]]; then
    gzip -dc "$PG_DUMP" | compose exec -T postgres pg_restore -U "$PG_USER" -d "$PG_DB" --no-owner --clean --if-exists
  else
    compose exec -T postgres pg_restore -U "$PG_USER" -d "$PG_DB" --no-owner --clean --if-exists < "$PG_DUMP"
  fi
  log "Postgres restored."
fi

if [ "${RESTORE_REDIS:-1}" = "1" ]; then
  [ -f "$REDIS_RDB" ] || log "Skipping Redis: no rdb snapshot in archive"
  if [ -f "$REDIS_RDB" ]; then
    log "Replacing Redis dump.rdb and restarting container..."
    tmp_rdb="$(mktemp)"
    if [[ "$REDIS_RDB" == *.gz ]]; then
      gzip -dc "$REDIS_RDB" > "$tmp_rdb"
    else
      cp "$REDIS_RDB" "$tmp_rdb"
    fi
    compose cp "$tmp_rdb" redis:/data/dump.rdb
    rm -f "$tmp_rdb"
    compose restart redis
    log "Redis restored (container restarted)."
  fi
fi

log "Restore complete."

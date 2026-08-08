# Backup strategy

Postgres is the source of truth; Redis holds ephemeral state (BullMQ queues, bot memory, leader-election, rate-limit counters). A backup of Postgres alone is sufficient for a full restore — Redis is preserved opportunistically to avoid re-processing already-consumed events after a restart.

## What gets backed up

| Data                                                    | Location           | Backed up by            |
| ------------------------------------------------------- | ------------------ | ----------------------- |
| Accounts, bots, scripts, webhooks, logs, users, proxies | Postgres `bothive` | `pg_dump` custom format |
| BullMQ queues, bot memory, pub/sub, counters            | Redis              | `BGSAVE` + `dump.rdb`   |

Credentials stored in Postgres are encrypted with `ENCRYPTION_KEY` before write, so a dump is not a plaintext leak of platform tokens — but treat the archive as sensitive anyway (`chmod 600`, encrypt in transit).

## Schedule

Run `backups/backup.sh` daily from cron (adjust the path):

```cron
# 03:15 UTC every day; logs to a file; no mail on success
15 3 * * * /opt/bothive/backups/backup.sh >> /var/log/bothive-backup.log 2>&1
```

Retention (override with `RETAIN_DAILY` / `RETAIN_WEEKLY` / `RETAIN_MONTHLY`):

- 7 dailies (~1 week)
- 4 weeklies (~1 month)
- 12 monthlies (~1 year)

Each run writes one timestamped directory under `backups/archive/` containing:

```
20260801-031500/
  bothive-postgres.dump.gz   # pg_dump, custom format
  bothive-redis.rdb.gz       # Redis snapshot (if any)
  redis-lastsave.txt         # Redis last-save epoch, for verification
  MANIFEST.sha256            # checksums of the above
```

## Restore

```bash
backups/restore.sh                    # newest archive
backups/restore.sh 20260801-031500    # specific archive
```

The script drops and recreates the Postgres database (data loss on the current DB) and, if an RDB snapshot is present, replaces `dump.rdb` and restarts Redis.

Dry-run verification of an archive without touching the stack:

```bash
cd backups/archive/20260801-031500
sha256sum -c MANIFEST.sha256
gzip -t bothive-postgres.dump.gz
```

## Recovery objectives

| Metric | Value                             | How                                                               |
| ------ | --------------------------------- | ----------------------------------------------------------------- |
| RPO    | ≤ 24 h (Postgres), ≤ 60 s (Redis) | daily `pg_dump`; Redis `BGSAVE` snapshots every 60 s by default   |
| RTO    | ~ minutes                         | single-node stack; restore = `docker compose up` + restore script |

For a smaller RPO, back up Postgres more often (e.g. hourly with `RETAIN_DAILY` adjusted) or run a streaming replica — out of scope for the default single-node deploy.

## Restore drill

1. `docker compose down` (stop writers so no new data lands during restore).
2. `backups/restore.sh <archive>`.
3. `docker compose up -d` and verify: `curl http://localhost:3000/health` → `ok`, log in, one bot reconnects.

## Off-site copy

The archive lives on the same host as the stack, so a host failure takes both. Push copies off-site, e.g.:

```cron
30 4 * * * rclone copy /opt/bothive/backups/archive remote:bothive-backups --transfers 1
```

## Notes / caveats

- `docker compose exec` requires the stack to be running. If Postgres/Redis are down, start them first: `docker compose up -d postgres redis`.
- Redis `dump.rdb` is only present after the first `BGSAVE`; the script retries briefly and warns otherwise.
- `MANIFEST.sha256` uses `sha256sum` (GNU coreutils) — run from a Linux host or WSL, not a bare Windows shell.

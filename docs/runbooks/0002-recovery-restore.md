# Runbook 0002 — Recovery & restore

Data lives in Postgres (source of truth) and Redis (ephemeral: queues, bot memory, pub/sub, leader leases, rate-limit counters). See `docs/backup.md` for the backup strategy.

## Restoring Postgres / Redis from backup

```bash
# 1. stop writers so no new data lands during restore
docker compose down
# 2. start only the data stores
docker compose up -d postgres redis
# 3. restore (drops and recreates the DB; Redis rdb replaced and container restarted)
backups/restore.sh                 # newest archive
backups/restore.sh 20260801-031500 # specific archive
# 4. bring the rest back up
docker compose up -d
# 5. verify
curl -s http://localhost:3000/health/ready   # => ok
docker compose logs --tail=50 workers-telegram
```

Restoring does **not** restore Redis _queues_ reliably — BullMQ jobs may be reprocessed or lost depending on the snapshot. This is expected; the leader-election + at-least-once guards prevent double execution of destructive actions.

## Lost or corrupted `ENCRYPTION_KEY`

Credentials are AES-256-GCM encrypted with `ENCRYPTION_KEY`. If it changes:

- Old credentials become undecryptable — `decryptCredential` returns `null`, bots fail to connect with a token error.
- The API/workers refuse to start in production if the key is missing or weak (`validateApiSecrets`).
- **There is no recovery path** — re-enter credentials for each account in the dashboard after restoring a correct key. This is why the key must be stored securely (password manager / secret manager) alongside backups.

## Worker stuck / no leader

Symptom: bots never connect, `QueueBacklog` alert, queue jobs not consumed.

```bash
docker compose logs workers-telegram | grep -iE "leader|error" | tail -50
docker compose exec redis redis-cli GET bothive:leader:telegram
```

- Lease exists but worker not processing → worker paused; confirm `resume`d on leader, restart the worker service.
- Lease expired + multiple replicas → they race for the lease; restart one and it self-heals.
- Redis down → no lease can be acquired; workers stay paused (safe). Restore Redis first.

## Failed jobs stuck in the queue

```bash
# inspect
docker compose exec redis redis-cli ZCARD bothive:telegram-queue:failed
# remove all failed jobs (loses them permanently)
docker compose exec redis redis-cli DEL bothive:telegram-queue:failed
# or, with a REPROCESS through the API dashboard when supported
```

Investigate the root cause (`docker compose logs workers-<platform>`) before clearing; otherwise jobs will fail again.

## Full machine loss

1. Rebuild the host, `docker compose up -d` (images pulled from Docker Hub or built).
2. Restore from the **off-site** backup copy (see `docs/backup.md`).
3. Re-seed the admin if needed: `docker compose exec api npx prisma db seed`.
4. Verify login and one bot reconnects per platform.

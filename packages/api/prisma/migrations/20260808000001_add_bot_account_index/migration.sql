-- Look up / count bots by owning account (account detail page, backup import
-- matching by accountId, cascade deletes).
CREATE INDEX IF NOT EXISTS "Bot_accountId_idx" ON "Bot"("accountId");

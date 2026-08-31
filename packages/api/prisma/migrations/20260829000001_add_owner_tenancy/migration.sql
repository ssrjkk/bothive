-- Add ownership (tenant) scoping to resources.
--
-- Existing rows are backfilled to the oldest surviving user so an already
-- initialized database keeps working after upgrading. Fresh databases have no
-- rows to backfill, so the NOT NULL constraint below is trivially satisfied.

-- 1. Add nullable ownerId columns to Account, Bot, Webhook.
ALTER TABLE "Account" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Bot" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Webhook" ADD COLUMN "ownerId" TEXT;

-- 2. Backfill: every legacy row belongs to the oldest user. If no user exists
-- yet (e.g. a database with resource rows but no registered account), create a
-- locked placeholder "system" owner so the NOT NULL constraint below holds; its
-- rows can be re-assigned to a real user later by an admin.
INSERT INTO "User" ("id", "email", "passwordHash", "name", "role", "createdAt", "updatedAt")
SELECT 'legacy-owner', 'legacy@local', '!locked!', 'Legacy Owner', 'viewer', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "User");

UPDATE "Account" SET "ownerId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1) WHERE "ownerId" IS NULL;
UPDATE "Bot" SET "ownerId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1) WHERE "ownerId" IS NULL;
UPDATE "Webhook" SET "ownerId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1) WHERE "ownerId" IS NULL;

-- 3. Enforce NOT NULL now that every row is owned.
ALTER TABLE "Account" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Bot" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Webhook" ALTER COLUMN "ownerId" SET NOT NULL;

-- 4. Foreign keys to User (cascade delete the owner's resources).
ALTER TABLE "Account" ADD CONSTRAINT "Account_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Indexes for tenant-scoped lookups.
CREATE INDEX "Account_ownerId_idx" ON "Account"("ownerId");
CREATE INDEX "Bot_ownerId_idx" ON "Bot"("ownerId");
CREATE INDEX "Bot_ownerId_platform_idx" ON "Bot"("ownerId", "platform");
CREATE INDEX "Webhook_ownerId_idx" ON "Webhook"("ownerId");

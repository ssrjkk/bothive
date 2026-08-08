-- Proxy pool for outbound bot connections. `url` stores an encrypted value
-- (may embed user:password); workers decrypt it at connect time.
CREATE TABLE "Proxy" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'http',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "healthScore" INTEGER NOT NULL DEFAULT 100,
    "lastFailedAt" TIMESTAMP(3),
    "requestsCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proxy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Proxy_enabled_idx" ON "Proxy"("enabled");

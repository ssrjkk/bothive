-- CreateTable
CREATE TABLE "EventRecord" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "eventId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "replayCount" INTEGER NOT NULL DEFAULT 0,
    "lastReplayedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventRecord_eventId_key" ON "EventRecord"("eventId");

-- CreateIndex
CREATE INDEX "EventRecord_botId_createdAt_idx" ON "EventRecord"("botId", "createdAt");

-- CreateIndex
CREATE INDEX "EventRecord_platform_type_idx" ON "EventRecord"("platform", "type");

-- CreateIndex
CREATE INDEX "EventRecord_createdAt_idx" ON "EventRecord"("createdAt");

-- AddForeignKey
ALTER TABLE "EventRecord" ADD CONSTRAINT "EventRecord_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
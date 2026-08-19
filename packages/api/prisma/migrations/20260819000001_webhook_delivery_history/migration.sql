-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "botId" TEXT,
    "status" TEXT NOT NULL,
    "statusCode" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookDelivery_webhookId_createdAt_idx" ON "WebhookDelivery"("webhookId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_idx" ON "WebhookDelivery"("status");

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
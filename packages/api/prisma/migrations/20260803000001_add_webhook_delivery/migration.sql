-- AlterTable
ALTER TABLE "Webhook" ADD COLUMN "deliveryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastDeliveredAt" TIMESTAMP(3),
ADD COLUMN "lastError" TEXT,
ADD COLUMN "lastStatus" TEXT;

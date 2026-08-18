-- Binance trading needs a separate API secret and a set of extra key pairs
-- that workers rotate through on reconnect. Both are stored encrypted (enc:...).
ALTER TABLE "Account" ADD COLUMN "apiSecret" TEXT;
ALTER TABLE "Account" ADD COLUMN "apiKeys" JSONB;
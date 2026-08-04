-- Add ON DELETE CASCADE so deleting a bot (or account) no longer fails when it
-- still has logs or scripts, and deleting an account removes its bots.
ALTER TABLE "Log" DROP CONSTRAINT IF EXISTS "Log_botId_fkey";
ALTER TABLE "Log" ADD CONSTRAINT "Log_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Script" DROP CONSTRAINT IF EXISTS "Script_botId_fkey";
ALTER TABLE "Script" ADD CONSTRAINT "Script_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Bot" DROP CONSTRAINT IF EXISTS "Bot_accountId_fkey";
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

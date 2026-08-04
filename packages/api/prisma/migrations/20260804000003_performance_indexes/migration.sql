-- Performance indexes for the hot queries:
--   - workers auto-start: Bot WHERE platform AND status IN (...)
--   - script engine reload: Script WHERE enabled
--   - per-bot script lookup and bot deletion (webhook unlink)
--   - webhook delivery dispatch by bot and enabled state
--   - account/platform matching on bot creation and backup export
CREATE INDEX "Account_platform_idx" ON "Account"("platform");
CREATE INDEX "Bot_platform_status_idx" ON "Bot"("platform", "status");
CREATE INDEX "Script_botId_trigger_idx" ON "Script"("botId", "trigger");
CREATE INDEX "Script_enabled_idx" ON "Script"("enabled");
CREATE INDEX "Webhook_botId_idx" ON "Webhook"("botId");
CREATE INDEX "Webhook_enabled_idx" ON "Webhook"("enabled");

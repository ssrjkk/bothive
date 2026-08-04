-- Index for the periodic log cleanup (deleteMany by createdAt cutoff).
CREATE INDEX "Log_createdAt_idx" ON "Log"("createdAt");

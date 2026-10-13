CREATE TYPE "Role" AS ENUM ('ADMIN', 'PARTICIPANT');
CREATE TYPE "SessionStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TABLE "User" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "email" TEXT NOT NULL, "username" TEXT,
  "password" TEXT NOT NULL, "team" TEXT, "role" "Role" NOT NULL DEFAULT 'PARTICIPANT',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE', "tokenLimit" INTEGER NOT NULL DEFAULT 1000000,
  "tokensUsed" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE TABLE "AgentSession" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "status" "SessionStatus" NOT NULL DEFAULT 'QUEUED',
  "environmentId" TEXT, "tokensUsed" INTEGER NOT NULL DEFAULT 0, "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3), "lastActivity" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TokenUsage" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL, "outputTokens" INTEGER NOT NULL, "cacheReadTokens" INTEGER NOT NULL,
  "cacheCreationTokens" INTEGER NOT NULL, "totalTokens" INTEGER NOT NULL, "model" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "TokenUsage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TokenUsage_requestId_key" ON "TokenUsage"("requestId");
CREATE INDEX "AgentSession_userId_idx" ON "AgentSession"("userId");
CREATE INDEX "AgentSession_status_idx" ON "AgentSession"("status");
CREATE INDEX "TokenUsage_userId_idx" ON "TokenUsage"("userId");
CREATE INDEX "TokenUsage_timestamp_idx" ON "TokenUsage"("timestamp");
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TokenUsage" ADD CONSTRAINT "TokenUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TokenUsage" ADD CONSTRAINT "TokenUsage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "Setting" ("key" TEXT NOT NULL, "value" TEXT NOT NULL, CONSTRAINT "Setting_pkey" PRIMARY KEY ("key"));

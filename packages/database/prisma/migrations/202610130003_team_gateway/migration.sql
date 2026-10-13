CREATE TABLE "Team" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "creditMicros" INTEGER NOT NULL DEFAULT 10000000, "spentMicros" INTEGER NOT NULL DEFAULT 0,
  "reservedMicros" INTEGER NOT NULL DEFAULT 0, "maxConcurrentRequests" INTEGER NOT NULL DEFAULT 2,
  "requestsPerMinute" INTEGER NOT NULL DEFAULT 60,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Team_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Team_valid_balance" CHECK ("creditMicros" >= 0 AND "creditMicros" <= 1000000000 AND "spentMicros" >= 0 AND "reservedMicros" >= 0 AND "spentMicros" + "reservedMicros" <= "creditMicros"),
  CONSTRAINT "Team_valid_limits" CHECK ("maxConcurrentRequests" BETWEEN 1 AND 20 AND "requestsPerMinute" BETWEEN 1 AND 1000),
  CONSTRAINT "Team_valid_status" CHECK ("status" IN ('ACTIVE', 'DISABLED'))
);
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");
CREATE TABLE "TeamApiKey" (
  "id" TEXT NOT NULL, "teamId" TEXT NOT NULL, "name" TEXT NOT NULL, "keyHash" TEXT NOT NULL,
  "prefix" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3), "lastUsedAt" TIMESTAMP(3), CONSTRAINT "TeamApiKey_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeamApiKey_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TeamApiKey_keyHash_key" ON "TeamApiKey"("keyHash");
CREATE INDEX "TeamApiKey_teamId_idx" ON "TeamApiKey"("teamId");
CREATE TABLE "GatewayRequest" (
  "id" TEXT NOT NULL, "teamId" TEXT NOT NULL, "keyId" TEXT NOT NULL, "model" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RESERVED', "reservedMicros" INTEGER NOT NULL, "chargedMicros" INTEGER NOT NULL DEFAULT 0,
  "inputRateMicros" INTEGER NOT NULL, "outputRateMicros" INTEGER NOT NULL, "inputBudget" INTEGER NOT NULL,
  "maxOutputTokens" INTEGER NOT NULL, "inputTokens" INTEGER NOT NULL DEFAULT 0, "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "estimated" BOOLEAN NOT NULL DEFAULT false, "providerRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt" TIMESTAMP(3), CONSTRAINT "GatewayRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GatewayRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GatewayRequest_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "TeamApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GatewayRequest_valid_status" CHECK ("status" IN ('RESERVED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  CONSTRAINT "GatewayRequest_valid_cost" CHECK ("reservedMicros" >= 0 AND "chargedMicros" >= 0 AND "chargedMicros" <= "reservedMicros")
);
CREATE INDEX "GatewayRequest_teamId_createdAt_idx" ON "GatewayRequest"("teamId", "createdAt");
CREATE INDEX "GatewayRequest_settledAt_lastActivity_idx" ON "GatewayRequest"("settledAt", "lastActivity");
CREATE TABLE "TeamCreditChange" (
  "id" TEXT NOT NULL, "teamId" TEXT NOT NULL, "amountMicros" INTEGER NOT NULL, "note" TEXT NOT NULL,
  "adminId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamCreditChange_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeamCreditChange_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "TeamCreditChange_teamId_createdAt_idx" ON "TeamCreditChange"("teamId", "createdAt");

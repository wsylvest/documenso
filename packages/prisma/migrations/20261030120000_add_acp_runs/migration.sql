-- CreateEnum
CREATE TYPE "AcpRunStatus" AS ENUM ('CREATED', 'IN_PROGRESS', 'AWAITING', 'CANCELLING', 'CANCELLED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "AcpRun" (
    "id" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "status" "AcpRunStatus" NOT NULL DEFAULT 'CREATED',
    "sessionId" TEXT,
    "idempotencyKey" TEXT,
    "input" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "state" JSONB,
    "awaitRequest" JSONB,
    "awaitResume" JSONB,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "userId" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "apiTokenId" INTEGER,

    CONSTRAINT "AcpRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcpRunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcpRunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcpRun_teamId_createdAt_idx" ON "AcpRun"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "AcpRun_sessionId_idx" ON "AcpRun"("sessionId");

-- CreateIndex
CREATE INDEX "AcpRun_status_idx" ON "AcpRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AcpRun_teamId_idempotencyKey_key" ON "AcpRun"("teamId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AcpRunEvent_runId_sequence_key" ON "AcpRunEvent"("runId", "sequence");

-- AddForeignKey
ALTER TABLE "AcpRun" ADD CONSTRAINT "AcpRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcpRun" ADD CONSTRAINT "AcpRun_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcpRun" ADD CONSTRAINT "AcpRun_apiTokenId_fkey" FOREIGN KEY ("apiTokenId") REFERENCES "ApiToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcpRunEvent" ADD CONSTRAINT "AcpRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AcpRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "EmailDomain"
  ALTER COLUMN "selector" DROP NOT NULL,
  ALTER COLUMN "publicKey" DROP NOT NULL,
  ALTER COLUMN "privateKey" DROP NOT NULL,
  ADD COLUMN "resendId" TEXT,
  ADD COLUMN "dnsRecords" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "emailTransportId" TEXT;
CREATE UNIQUE INDEX "EmailDomain_resendId_key" ON "EmailDomain"("resendId");
ALTER TABLE "EmailDomain" ADD CONSTRAINT "EmailDomain_emailTransportId_fkey"
  FOREIGN KEY ("emailTransportId") REFERENCES "EmailTransport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

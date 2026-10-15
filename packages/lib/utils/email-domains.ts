import { z } from 'zod';

export const generateDkimRecord = (recordName: string, publicKeyFlattened: string) => {
  return {
    name: recordName,
    value: `v=DKIM1; k=rsa; p=${publicKeyFlattened}`,
    type: 'TXT',
  };
};

export const AWS_SES_SPF_RECORD = {
  name: `@`,
  value: 'v=spf1 include:amazonses.com -all',
  type: 'TXT',
};

export const generateEmailDomainRecords = (
  recordName: string,
  publicKeyFlattened: string,
): z.infer<typeof ZEmailDomainRecord>[] => {
  return [generateDkimRecord(recordName, publicKeyFlattened), AWS_SES_SPF_RECORD];
};

export const ZEmailDomainRecord = z.object({
  name: z.string(),
  value: z.string(),
  type: z.string(),
  priority: z.number().optional(),
  ttl: z.string().optional(),
  status: z.string().optional(),
});

export type TEmailDomainRecord = z.infer<typeof ZEmailDomainRecord>;

export const getEmailDomainRecords = (domain: {
  resendId: string | null;
  dnsRecords: unknown;
  selector: string | null;
  publicKey: string | null;
}) => {
  if (domain.resendId) {
    return ZEmailDomainRecord.array().parse(domain.dnsRecords);
  }
  return domain.selector && domain.publicKey ? generateEmailDomainRecords(domain.selector, domain.publicKey) : [];
};

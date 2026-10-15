import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import {
  getResendApiKey,
  getResendDomain,
  isResendDomainVerified,
  requestResendDomains,
  ZResendDomain,
} from '@documenso/lib/server-only/email/resend-domains';
import { generateDatabaseId } from '@documenso/lib/universal/id';
import { prisma } from '@documenso/prisma';

/** Permission to manage the organisation and selected transport must be checked by the caller. */
export const saveResendEmailDomain = async ({
  organisationId,
  emailTransportId,
  domain,
  resendId,
}: {
  organisationId: string;
  emailTransportId: string | null;
} & ({ domain: string; resendId?: never } | { domain?: never; resendId: string })) => {
  await prisma.organisation.findUniqueOrThrow({ where: { id: organisationId }, select: { id: true } });
  if (domain && (await prisma.emailDomain.findUnique({ where: { domain } }))) {
    throw new AppError(AppErrorCode.ALREADY_EXISTS, { message: 'This domain is already attached to an organisation.' });
  }
  const remote = resendId
    ? await getResendDomain(emailTransportId, resendId)
    : ZResendDomain.parse(
        await requestResendDomains(await getResendApiKey(emailTransportId), '', {
          method: 'POST',
          body: JSON.stringify({ name: domain }),
        }),
      );
  const existing = await prisma.emailDomain.findUnique({ where: { domain: remote.name.toLowerCase() } });
  if (existing) {
    throw new AppError(AppErrorCode.ALREADY_EXISTS, {
      message: 'This domain is already attached to an organisation. Open it from the domain list.',
    });
  }
  const emailDomain = await prisma.emailDomain.create({
    data: {
      id: generateDatabaseId('email_domain'),
      organisationId,
      emailTransportId,
      domain: remote.name.toLowerCase(),
      resendId: remote.id,
      dnsRecords: remote.records,
      status: isResendDomainVerified(remote) ? 'ACTIVE' : 'PENDING',
      lastVerifiedAt: new Date(),
    },
    omit: { privateKey: true },
    include: { emails: true },
  });
  return { emailDomain, records: remote.records };
};

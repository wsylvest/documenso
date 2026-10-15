import { GetEmailIdentityCommand } from '@aws-sdk/client-sesv2';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import {
  getResendApiKey,
  getResendDomain,
  isResendDomainVerified,
  requestResendDomains,
} from '@documenso/lib/server-only/email/resend-domains';
import { prisma } from '@documenso/prisma';
import { EmailDomainStatus } from '@prisma/client';

import { getSesClient } from './create-email-domain';

export const verifyEmailDomain = async (emailDomainId: string, requestVerification = false) => {
  const emailDomain = await prisma.emailDomain.findUnique({
    where: {
      id: emailDomainId,
    },
  });

  if (!emailDomain) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'Email domain not found',
    });
  }

  if (emailDomain.resendId) {
    if (requestVerification) {
      await requestResendDomains(
        await getResendApiKey(emailDomain.emailTransportId),
        `/${emailDomain.resendId}/verify`,
        { method: 'POST' },
      );
    }
    const remote = await getResendDomain(emailDomain.emailTransportId, emailDomain.resendId);
    const isVerified = isResendDomainVerified(remote);
    const updatedEmailDomain = await prisma.emailDomain.update({
      where: { id: emailDomain.id },
      data: { status: isVerified ? 'ACTIVE' : 'PENDING', dnsRecords: remote.records, lastVerifiedAt: new Date() },
    });
    return { emailDomain: updatedEmailDomain, isVerified };
  }

  const sesClient = getSesClient();

  const response = await sesClient.send(
    new GetEmailIdentityCommand({
      EmailIdentity: emailDomain.domain,
    }),
  );

  const isVerified = response.VerificationStatus === 'SUCCESS';

  const updatedEmailDomain = await prisma.emailDomain.update({
    where: {
      id: emailDomainId,
    },
    data: {
      status: isVerified ? EmailDomainStatus.ACTIVE : EmailDomainStatus.PENDING,
      lastVerifiedAt: new Date(),
    },
  });

  return {
    emailDomain: updatedEmailDomain,
    isVerified,
  };
};

import { prisma } from '@documenso/prisma';
import { DocumentStatus, EnvelopeType, RecipientRole, SigningStatus } from '@prisma/client';
import { z } from 'zod';

import { AppError, AppErrorCode } from '../../errors/app-error';

export const ZEnvelopeSigningStatusSchema = z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED']);

export type TEnvelopeSigningStatus = z.infer<typeof ZEnvelopeSigningStatusSchema>;

export type GetEnvelopeSigningStatusOptions = {
  /**
   * The recipient signing token.
   */
  token: string;
};

/**
 * Resolve the overall signing state of the envelope a recipient token belongs to.
 *
 * `PROCESSING` means every actionable recipient has finished but the sealing
 * job has not yet marked the envelope as completed.
 */
export const getEnvelopeSigningStatus = async ({
  token,
}: GetEnvelopeSigningStatusOptions): Promise<TEnvelopeSigningStatus> => {
  const envelope = await prisma.envelope.findFirst({
    where: {
      type: EnvelopeType.DOCUMENT,
      recipients: {
        some: {
          token,
        },
      },
    },
    include: {
      recipients: {
        select: {
          id: true,
          signingStatus: true,
          role: true,
        },
      },
    },
  });

  if (!envelope) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'Envelope not found',
    });
  }

  if (envelope.status === DocumentStatus.REJECTED) {
    return 'REJECTED';
  }

  if (envelope.status === DocumentStatus.COMPLETED) {
    return 'COMPLETED';
  }

  const isComplete =
    envelope.recipients.some((recipient) => recipient.signingStatus === SigningStatus.REJECTED) ||
    envelope.recipients.every(
      (recipient) => recipient.role === RecipientRole.CC || recipient.signingStatus === SigningStatus.SIGNED,
    );

  return isComplete ? 'PROCESSING' : 'PENDING';
};

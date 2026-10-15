import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { isRecipientAuthorized } from '@documenso/lib/server-only/document/is-recipient-authorized';
import { consentToElectronicSigning } from '@documenso/lib/server-only/envelope/consent-to-electronic-signing';
import { prisma } from '@documenso/prisma';
import { DocumentStatus, EnvelopeType } from '@prisma/client';

import { procedure } from '../trpc';
import {
  ZConsentToElectronicSigningRequestSchema,
  ZConsentToElectronicSigningResponseSchema,
} from './consent-to-electronic-signing.types';

// Note that this is an unauthenticated public procedure route keyed by the recipient token.
export const consentToElectronicSigningRoute = procedure
  .input(ZConsentToElectronicSigningRequestSchema)
  .output(ZConsentToElectronicSigningResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { token } = input;

    // Mirror the signing page: the recipient must be allowed to access the
    // envelope before consent can be recorded against it. ACCOUNT access auth
    // requires the matching signed-in user; two factor is verified at completion.
    const recipient = await prisma.recipient.findFirst({
      where: {
        token,
        envelope: {
          type: EnvelopeType.DOCUMENT,
          status: DocumentStatus.PENDING,
          deletedAt: null,
        },
      },
      select: {
        id: true,
        envelopeId: true,
        email: true,
        authOptions: true,
        envelope: {
          select: {
            authOptions: true,
          },
        },
      },
    });

    if (!recipient) {
      throw new AppError(AppErrorCode.NOT_FOUND, {
        message: 'Recipient not found for the provided signing token',
      });
    }

    const isAccessAuthorized = await isRecipientAuthorized({
      type: 'ACCESS',
      documentAuthOptions: recipient.envelope.authOptions,
      recipient,
      userId: ctx.user?.id,
    });

    if (!isAccessAuthorized) {
      throw new AppError(AppErrorCode.UNAUTHORIZED, {
        message: 'Invalid access values',
      });
    }

    // The signing token is a bearer credential and must not be logged.
    ctx.logger.info({
      input: {
        envelopeId: recipient.envelopeId,
        recipientId: recipient.id,
      },
    });

    const consentedRecipient = await consentToElectronicSigning({
      token,
      requestMetadata: ctx.metadata.requestMetadata,
    });

    // consentToElectronicSigning only returns once the timestamp is set.
    return {
      electronicConsentAt: consentedRecipient.electronicConsentAt ?? new Date(),
    };
  });

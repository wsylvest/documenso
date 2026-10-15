import { prepareCscRecipientSigning } from '@documenso/ee/server-only/signing/csc/prepare-recipient-signing';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { completeDocumentWithToken } from '@documenso/lib/server-only/document/complete-document-with-token';
import { isTspEnvelope } from '@documenso/lib/types/signature-level';

import { authenticatedProcedure } from '../trpc';
import {
  completeSigningMeta,
  ZCompleteSigningRequestSchema,
  ZCompleteSigningResponseSchema,
} from './complete-signing.types';
import { getSigningRecipient } from './get-signing-recipient';
import { resolveSignerRequestMetadata } from './signer-metadata';

export const completeSigningRoute = authenticatedProcedure
  .meta(completeSigningMeta)
  .input(ZCompleteSigningRequestSchema)
  .output(ZCompleteSigningResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { teamId } = ctx;
    const { token, accessAuthOptions, nextSigner, recipientOverride, signer } = input;

    const recipient = await getSigningRecipient({ token, teamId });

    ctx.logger.info({
      input: {
        envelopeId: recipient.envelopeId,
        recipientId: recipient.id,
      },
    });

    const requestMetadata = resolveSignerRequestMetadata({ ctx, signer });

    // AES/QES envelopes cannot be completed in place. The signer must finish
    // with the trust service provider, so hand back the OAuth redirect URL.
    if (isTspEnvelope(recipient.envelope)) {
      return await prepareCscRecipientSigning({
        recipientToken: token,
        requestMetadata,
      });
    }

    try {
      // The user ID is deliberately not passed: an API caller is the integration,
      // not the recipient, so ACCOUNT access auth cannot be satisfied here.
      await completeDocumentWithToken({
        token,
        id: {
          type: 'envelopeId',
          id: recipient.envelopeId,
        },
        accessAuthOptions,
        nextSigner,
        recipientOverride,
        requestMetadata,
      });

      return { status: 'SIGNED' as const };
    } catch (err) {
      // Retried or concurrent completions resolve idempotently so the caller
      // can treat the recipient as done instead of surfacing an error.
      if (err instanceof AppError && err.code === AppErrorCode.RECIPIENT_ALREADY_SIGNED) {
        ctx.logger.info({
          message: 'Recipient attempted to complete a document they have already signed',
        });

        return { status: 'ALREADY_SIGNED' as const };
      }

      throw err;
    }
  });

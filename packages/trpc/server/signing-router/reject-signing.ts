import { rejectDocumentWithToken } from '@documenso/lib/server-only/document/reject-document-with-token';

import { authenticatedProcedure } from '../trpc';
import { getSigningRecipient } from './get-signing-recipient';
import { rejectSigningMeta, ZRejectSigningRequestSchema, ZRejectSigningResponseSchema } from './reject-signing.types';
import { resolveSignerRequestMetadata } from './signer-metadata';

export const rejectSigningRoute = authenticatedProcedure
  .meta(rejectSigningMeta)
  .input(ZRejectSigningRequestSchema)
  .output(ZRejectSigningResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { teamId } = ctx;
    const { token, reason, signer } = input;

    const recipient = await getSigningRecipient({ token, teamId });

    ctx.logger.info({
      input: {
        envelopeId: recipient.envelopeId,
        recipientId: recipient.id,
      },
    });

    const requestMetadata = resolveSignerRequestMetadata({ ctx, signer });

    await rejectDocumentWithToken({
      token,
      id: {
        type: 'envelopeId',
        id: recipient.envelopeId,
      },
      reason,
      requestMetadata,
    });

    return {
      success: true,
    };
  });

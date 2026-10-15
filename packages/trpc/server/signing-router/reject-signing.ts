import { rejectDocumentWithToken } from '@documenso/lib/server-only/document/reject-document-with-token';

import { authenticatedProcedure } from '../trpc';
import { assertSigningAccessAuth } from './assert-signing-access-auth';
import { getSigningRecipient } from './get-signing-recipient';
import { rejectSigningMeta, ZRejectSigningRequestSchema, ZRejectSigningResponseSchema } from './reject-signing.types';
import { resolveSignerRequestMetadata } from './signer-metadata';

export const rejectSigningRoute = authenticatedProcedure
  .meta(rejectSigningMeta)
  .input(ZRejectSigningRequestSchema)
  .output(ZRejectSigningResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { teamId } = ctx;
    const { token, reason, accessAuthOptions, signer } = input;

    const recipient = await getSigningRecipient({ token, teamId });

    ctx.logger.info({
      input: {
        envelopeId: recipient.envelopeId,
        recipientId: recipient.id,
      },
    });

    // Rejection is terminal, so it requires the same access proof as completion.
    await assertSigningAccessAuth({
      recipient,
      envelopeAuthOptions: recipient.envelope.authOptions,
      type: 'ACCESS_2FA',
      accessAuthOptions,
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

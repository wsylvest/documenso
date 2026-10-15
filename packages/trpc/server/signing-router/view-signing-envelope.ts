import { viewedDocument } from '@documenso/lib/server-only/document/viewed-document';

import { authenticatedProcedure } from '../trpc';
import { assertSigningAccessAuth } from './assert-signing-access-auth';
import { getSigningRecipient } from './get-signing-recipient';
import { resolveSignerRequestMetadata } from './signer-metadata';
import {
  viewSigningEnvelopeMeta,
  ZViewSigningEnvelopeRequestSchema,
  ZViewSigningEnvelopeResponseSchema,
} from './view-signing-envelope.types';

export const viewSigningEnvelopeRoute = authenticatedProcedure
  .meta(viewSigningEnvelopeMeta)
  .input(ZViewSigningEnvelopeRequestSchema)
  .output(ZViewSigningEnvelopeResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { teamId } = ctx;
    const { token, signer } = input;

    const recipient = await getSigningRecipient({ token, teamId });

    ctx.logger.info({
      input: {
        envelopeId: recipient.envelopeId,
        recipientId: recipient.id,
      },
    });

    // Mirrors the signing page: the view is recorded once the recipient can
    // access the envelope, before any two factor code is entered.
    const derivedRecipientAccessAuth = await assertSigningAccessAuth({
      recipient,
      envelopeAuthOptions: recipient.envelope.authOptions,
      type: 'ACCESS',
    });

    const requestMetadata = resolveSignerRequestMetadata({ ctx, signer });

    await viewedDocument({
      token,
      requestMetadata,
      recipientAccessAuth: derivedRecipientAccessAuth,
    });

    return {
      success: true,
    };
  });

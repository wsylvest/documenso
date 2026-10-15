import { viewedDocument } from '@documenso/lib/server-only/document/viewed-document';
import { extractDocumentAuthMethods } from '@documenso/lib/utils/document-auth';

import { authenticatedProcedure } from '../trpc';
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

    const requestMetadata = resolveSignerRequestMetadata({ ctx, signer });

    const { derivedRecipientAccessAuth } = extractDocumentAuthMethods({
      documentAuth: recipient.envelope.authOptions,
      recipientAuth: recipient.authOptions,
    });

    await viewedDocument({
      token,
      requestMetadata,
      recipientAccessAuth: derivedRecipientAccessAuth,
    });

    return {
      success: true,
    };
  });

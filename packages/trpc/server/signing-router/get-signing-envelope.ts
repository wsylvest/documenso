import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { getEnvelopeForRecipientSigning } from '@documenso/lib/server-only/envelope/get-envelope-for-recipient-signing';

import { authenticatedProcedure } from '../trpc';
import {
  getSigningEnvelopeMeta,
  ZGetSigningEnvelopeRequestSchema,
  ZGetSigningEnvelopeResponseSchema,
} from './get-signing-envelope.types';
import { getSigningRecipient } from './get-signing-recipient';

export const getSigningEnvelopeRoute = authenticatedProcedure
  .meta(getSigningEnvelopeMeta)
  .input(ZGetSigningEnvelopeRequestSchema)
  .output(ZGetSigningEnvelopeResponseSchema)
  .query(async ({ input, ctx }) => {
    const { teamId } = ctx;
    const { token } = input;

    const recipient = await getSigningRecipient({ token, teamId });

    ctx.logger.info({
      input: {
        envelopeId: recipient.envelopeId,
        recipientId: recipient.id,
      },
    });

    // The user ID is deliberately not passed: an API caller is the integration,
    // not the recipient, so ACCOUNT access auth cannot be satisfied here.
    const envelopeForSigning = await getEnvelopeForRecipientSigning({
      token,
    });

    const files = envelopeForSigning.envelope.envelopeItems
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((item) => ({
        envelopeItemId: item.id,
        url: `${NEXT_PUBLIC_WEBAPP_URL()}/api/files/token/${token}/envelopeItem/${item.id}`,
      }));

    return {
      ...envelopeForSigning,
      files,
    };
  });

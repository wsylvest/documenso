import { getEnvelopeSigningStatus } from '@documenso/lib/server-only/envelope/get-envelope-signing-status';

import { authenticatedProcedure } from '../trpc';
import { getSigningRecipient } from './get-signing-recipient';
import {
  getSigningStatusMeta,
  ZGetSigningStatusRequestSchema,
  ZGetSigningStatusResponseSchema,
} from './get-signing-status.types';

export const getSigningStatusRoute = authenticatedProcedure
  .meta(getSigningStatusMeta)
  .input(ZGetSigningStatusRequestSchema)
  .output(ZGetSigningStatusResponseSchema)
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

    const status = await getEnvelopeSigningStatus({ token });

    return {
      status,
    };
  });

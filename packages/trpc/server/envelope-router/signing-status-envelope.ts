import { getEnvelopeSigningStatus } from '@documenso/lib/server-only/envelope/get-envelope-signing-status';

import { maybeAuthenticatedProcedure } from '../trpc';
import {
  ZSigningStatusEnvelopeRequestSchema,
  ZSigningStatusEnvelopeResponseSchema,
} from './signing-status-envelope.types';

// Internal route - not intended for public API usage
export const signingStatusEnvelopeRoute = maybeAuthenticatedProcedure
  .input(ZSigningStatusEnvelopeRequestSchema)
  .output(ZSigningStatusEnvelopeResponseSchema)
  .query(async ({ input, ctx }) => {
    const { token } = input;

    ctx.logger.info({
      input: {
        token,
      },
    });

    const status = await getEnvelopeSigningStatus({ token });

    return {
      status,
    };
  });

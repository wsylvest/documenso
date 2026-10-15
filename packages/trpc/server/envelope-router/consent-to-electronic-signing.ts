import { consentToElectronicSigning } from '@documenso/lib/server-only/envelope/consent-to-electronic-signing';

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

    ctx.logger.info({
      input: {
        token,
      },
    });

    const recipient = await consentToElectronicSigning({
      token,
      requestMetadata: ctx.metadata.requestMetadata,
    });

    // consentToElectronicSigning only returns once the timestamp is set.
    return {
      electronicConsentAt: recipient.electronicConsentAt ?? new Date(),
    };
  });

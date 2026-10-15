import { consentToElectronicSigning } from '@documenso/lib/server-only/envelope/consent-to-electronic-signing';

import { authenticatedProcedure } from '../trpc';
import { assertSigningAccessAuth } from './assert-signing-access-auth';
import {
  consentSigningMeta,
  ZConsentSigningRequestSchema,
  ZConsentSigningResponseSchema,
} from './consent-signing.types';
import { getSigningRecipient } from './get-signing-recipient';
import { resolveSignerRequestMetadata } from './signer-metadata';

export const consentSigningRoute = authenticatedProcedure
  .meta(consentSigningMeta)
  .input(ZConsentSigningRequestSchema)
  .output(ZConsentSigningResponseSchema)
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

    await assertSigningAccessAuth({
      recipient,
      envelopeAuthOptions: recipient.envelope.authOptions,
      type: 'ACCESS',
    });

    const requestMetadata = resolveSignerRequestMetadata({ ctx, signer });

    const consentedRecipient = await consentToElectronicSigning({
      token,
      requestMetadata,
    });

    return {
      electronicConsentAt: consentedRecipient.electronicConsentAt ?? new Date(),
    };
  });

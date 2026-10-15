import { signEnvelopeField } from '@documenso/lib/server-only/envelope/sign-envelope-field';

import { authenticatedProcedure } from '../trpc';
import { assertSigningAccessAuth } from './assert-signing-access-auth';
import { getSigningRecipient } from './get-signing-recipient';
import {
  signSigningFieldMeta,
  ZSignSigningFieldRequestSchema,
  ZSignSigningFieldResponseSchema,
} from './sign-signing-field.types';
import { resolveSignerRequestMetadata } from './signer-metadata';

export const signSigningFieldRoute = authenticatedProcedure
  .meta(signSigningFieldMeta)
  .input(ZSignSigningFieldRequestSchema)
  .output(ZSignSigningFieldResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { teamId } = ctx;
    const { token, fieldId, fieldValue, authOptions, signer } = input;

    const recipient = await getSigningRecipient({ token, teamId });

    ctx.logger.info({
      input: {
        envelopeId: recipient.envelopeId,
        recipientId: recipient.id,
        fieldId,
      },
    });

    await assertSigningAccessAuth({
      recipient,
      envelopeAuthOptions: recipient.envelope.authOptions,
      type: 'ACCESS',
    });

    const requestMetadata = resolveSignerRequestMetadata({ ctx, signer });

    // The user ID is deliberately not passed: an API caller is the integration,
    // not the recipient, so ACCOUNT action auth cannot be satisfied here.
    return await signEnvelopeField({
      token,
      fieldId,
      fieldValue,
      authOptions,
      requestMetadata,
    });
  });

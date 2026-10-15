import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { TWO_FACTOR_EMAIL_EXPIRATION_MINUTES } from '@documenso/lib/server-only/2fa/email/constants';
import { send2FATokenEmail } from '@documenso/lib/server-only/2fa/email/send-2fa-token-email';
import { assertRateLimit } from '@documenso/lib/server-only/rate-limit/rate-limit-middleware';
import { request2FAEmailRateLimit } from '@documenso/lib/server-only/rate-limit/rate-limits';
import { DocumentAuth } from '@documenso/lib/types/document-auth';
import { extractDocumentAuthMethods } from '@documenso/lib/utils/document-auth';
import { DateTime } from 'luxon';

import { authenticatedProcedure } from '../trpc';
import { getSigningRecipient } from './get-signing-recipient';
import {
  requestSigningAccessCodeMeta,
  ZRequestSigningAccessCodeRequestSchema,
  ZRequestSigningAccessCodeResponseSchema,
} from './request-signing-access-code.types';

export const requestSigningAccessCodeRoute = authenticatedProcedure
  .meta(requestSigningAccessCodeMeta)
  .input(ZRequestSigningAccessCodeRequestSchema)
  .output(ZRequestSigningAccessCodeResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { teamId } = ctx;
    const { token } = input;

    const recipient = await getSigningRecipient({ token, teamId });

    ctx.logger.info({
      input: {
        envelopeId: recipient.envelopeId,
        recipientId: recipient.id,
      },
    });

    const rateLimitResult = await request2FAEmailRateLimit.check({
      ip: ctx.metadata.requestMetadata.ipAddress ?? 'unknown',
      identifier: token,
    });

    assertRateLimit(rateLimitResult);

    const { derivedRecipientAccessAuth } = extractDocumentAuthMethods({
      documentAuth: recipient.envelope.authOptions,
      recipientAuth: recipient.authOptions,
    });

    if (!derivedRecipientAccessAuth.includes(DocumentAuth.TWO_FACTOR_AUTH)) {
      throw new AppError(AppErrorCode.INVALID_REQUEST, {
        message: 'Two factor access authentication is not required for this envelope',
      });
    }

    const expiresAt = DateTime.now().plus({ minutes: TWO_FACTOR_EMAIL_EXPIRATION_MINUTES });

    await send2FATokenEmail({
      token,
      envelopeId: recipient.envelopeId,
    });

    return {
      success: true,
      expiresAt: expiresAt.toJSDate(),
    };
  });

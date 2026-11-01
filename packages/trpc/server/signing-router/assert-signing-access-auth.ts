import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { isRecipientAuthorized } from '@documenso/lib/server-only/document/is-recipient-authorized';
import { DocumentAuth, type TRecipientAccessAuth } from '@documenso/lib/types/document-auth';
import { extractDocumentAuthMethods } from '@documenso/lib/utils/document-auth';
import type { Envelope, Recipient } from '@prisma/client';

type AssertSigningAccessAuthOptions = {
  recipient: Pick<Recipient, 'authOptions' | 'email' | 'envelopeId'>;
  envelopeAuthOptions: Envelope['authOptions'];

  /**
   * `ACCESS` checks that the envelope can be accessed at all and allows two
   * factor envelopes through, matching the signing page before the code is
   * entered. `ACCESS_2FA` additionally requires and verifies the two factor
   * proof, matching completion.
   */
  type: 'ACCESS' | 'ACCESS_2FA';
  accessAuthOptions?: TRecipientAccessAuth;
};

/**
 * Enforce the recipient's access authentication for Signing API calls.
 *
 * The Signing API acts on behalf of the recipient from an integration's
 * backend, so ACCOUNT access authentication (which requires the recipient to be
 * signed in to SR Sign) can never be satisfied and is rejected outright.
 */
export const assertSigningAccessAuth = async ({
  recipient,
  envelopeAuthOptions,
  type,
  accessAuthOptions,
}: AssertSigningAccessAuthOptions) => {
  const { derivedRecipientAccessAuth } = extractDocumentAuthMethods({
    documentAuth: envelopeAuthOptions,
    recipientAuth: recipient.authOptions,
  });

  if (derivedRecipientAccessAuth.includes(DocumentAuth.ACCOUNT)) {
    throw new AppError(AppErrorCode.UNAUTHORIZED, {
      message: 'This envelope requires the recipient to sign in to SR Sign and cannot be signed through the API',
    });
  }

  const requiresTwoFactor = derivedRecipientAccessAuth.includes(DocumentAuth.TWO_FACTOR_AUTH);

  if (type === 'ACCESS_2FA' && requiresTwoFactor && !accessAuthOptions) {
    throw new AppError(AppErrorCode.UNAUTHORIZED, {
      message:
        'This envelope requires two factor access authentication. Provide accessAuthOptions with the emailed code.',
    });
  }

  const isAuthorized = await isRecipientAuthorized({
    type,
    documentAuthOptions: envelopeAuthOptions,
    recipient,
    authOptions: accessAuthOptions,
  });

  if (!isAuthorized) {
    throw new AppError(AppErrorCode.UNAUTHORIZED, {
      message: 'Invalid access authentication values',
    });
  }

  return derivedRecipientAccessAuth;
};

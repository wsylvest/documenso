import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { prisma } from '@documenso/prisma';
import { EnvelopeType } from '@prisma/client';

type GetSigningRecipientOptions = {
  token: string;

  /**
   * The team the API caller is scoped to. The recipient's envelope must belong
   * to this team so an integration can only drive signing for its own documents.
   */
  teamId: number;
};

/**
 * Resolve the recipient and envelope for a signing token, scoped to the
 * caller's team. Throws NOT_FOUND when the token is unknown or belongs to a
 * different team so callers cannot probe for tokens outside their scope.
 */
export const getSigningRecipient = async ({ token, teamId }: GetSigningRecipientOptions) => {
  const recipient = await prisma.recipient.findFirst({
    where: {
      token,
      envelope: {
        type: EnvelopeType.DOCUMENT,
        teamId,
      },
    },
    include: {
      envelope: {
        select: {
          id: true,
          teamId: true,
          status: true,
          internalVersion: true,
          signatureLevel: true,
          authOptions: true,
        },
      },
    },
  });

  if (!recipient) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'Recipient not found for the provided signing token',
      statusCode: 404,
    });
  }

  return recipient;
};

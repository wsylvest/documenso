import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { getEnvelopeById } from '@documenso/lib/server-only/envelope/get-envelope-by-id';
import type { EnvelopeIdOptions } from '@documenso/lib/utils/envelope';
import { mapSecondaryIdToDocumentId } from '@documenso/lib/utils/envelope';
import { formatSigningLink } from '@documenso/lib/utils/recipients';
import type { Recipient } from '@prisma/client';
import { EnvelopeType, RecipientRole, SigningStatus } from '@prisma/client';
import { z } from 'zod';

import type { AcpPrincipal } from './types';

/**
 * Helpers shared by the agents.
 */

export const ZEnvelopeReferenceSchema = z.object({
  envelopeId: z.string().min(1).optional().describe('The envelope ID (preferred).'),
  documentId: z.coerce.number().int().positive().optional().describe('The legacy numeric document ID.'),
});

export type TEnvelopeReference = z.infer<typeof ZEnvelopeReferenceSchema>;

export const toEnvelopeIdOptions = ({ envelopeId, documentId }: TEnvelopeReference): EnvelopeIdOptions => {
  if (envelopeId) {
    return { type: 'envelopeId', id: envelopeId };
  }

  if (documentId !== undefined) {
    return { type: 'documentId', id: documentId };
  }

  throw new AppError(AppErrorCode.INVALID_BODY, {
    message: 'Either envelopeId or documentId is required',
    statusCode: 400,
  });
};

/**
 * Load a document envelope the principal is allowed to see. Team scoping and
 * visibility rules are enforced by `getEnvelopeById`.
 */
export const getDocumentEnvelopeForPrincipal = async (principal: AcpPrincipal, id: EnvelopeIdOptions) => {
  return await getEnvelopeById({
    id,
    type: EnvelopeType.DOCUMENT,
    userId: principal.user.id,
    teamId: principal.teamId,
  });
};

export const isPendingRecipient = (recipient: Pick<Recipient, 'role' | 'signingStatus'>): boolean => {
  return recipient.role !== RecipientRole.CC && recipient.signingStatus === SigningStatus.NOT_SIGNED;
};

export const summariseRecipient = (recipient: Recipient) => ({
  id: recipient.id,
  name: recipient.name,
  email: recipient.email,
  role: recipient.role,
  signingOrder: recipient.signingOrder,
  signingStatus: recipient.signingStatus,
  sendStatus: recipient.sendStatus,
  readStatus: recipient.readStatus,
  signedAt: recipient.signedAt ? recipient.signedAt.toISOString() : null,
  rejectionReason: recipient.rejectionReason,
  signingUrl: formatSigningLink(recipient.token),
});

type EnvelopeSummaryInput = {
  id: string;
  secondaryId: string;
  title: string;
  status: string;
  externalId: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

export const summariseEnvelope = (envelope: EnvelopeSummaryInput) => ({
  envelopeId: envelope.id,
  documentId: mapSecondaryIdToDocumentId(envelope.secondaryId),
  title: envelope.title,
  status: envelope.status,
  externalId: envelope.externalId,
  createdAt: envelope.createdAt.toISOString(),
  completedAt: envelope.completedAt ? envelope.completedAt.toISOString() : null,
});

/**
 * Lib functions such as `signFieldWithToken` throw plain `Error`s for
 * recipient-facing validation problems. Surface those as 400s instead of 500s.
 */
export const asInvalidRequest = (error: unknown): never => {
  if (error instanceof AppError) {
    throw error;
  }

  throw new AppError(AppErrorCode.INVALID_REQUEST, {
    message: error instanceof Error ? error.message : 'Request could not be processed',
    statusCode: 400,
  });
};

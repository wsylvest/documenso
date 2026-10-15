import { prisma } from '@documenso/prisma';
import type { Recipient } from '@prisma/client';
import { DocumentStatus, EnvelopeType } from '@prisma/client';

import { ELECTRONIC_CONSENT_DISCLOSURE_VERSION } from '../../constants/electronic-consent';
import { AppError, AppErrorCode } from '../../errors/app-error';
import { DOCUMENT_AUDIT_LOG_TYPE } from '../../types/document-audit-logs';
import type { RequestMetadata } from '../../universal/extract-request-metadata';
import { createDocumentAuditLogData } from '../../utils/document-audit-logs';

export type ConsentToElectronicSigningOptions = {
  /**
   * The recipient signing token.
   */
  token: string;
  requestMetadata?: RequestMetadata;
};

/**
 * Record the recipient's affirmative consent to conduct the transaction
 * electronically, as required for consumer transactions under ESIGN.
 *
 * Idempotent: a recipient who has already consented is returned unchanged so a
 * refreshed signing page does not write a second consent event.
 */
export const consentToElectronicSigning = async ({ token, requestMetadata }: ConsentToElectronicSigningOptions) => {
  const recipient = await prisma.recipient.findFirst({
    where: {
      token,
      envelope: {
        type: EnvelopeType.DOCUMENT,
        deletedAt: null,
      },
    },
    include: {
      envelope: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  });

  if (!recipient) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'Recipient not found for the provided signing token',
    });
  }

  if (recipient.electronicConsentAt) {
    return recipient;
  }

  if (recipient.envelope.status !== DocumentStatus.PENDING) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `Document ${recipient.envelope.id} must be pending to record consent`,
    });
  }

  const [updatedRecipient] = await prisma.$transaction([
    prisma.recipient.update({
      where: {
        id: recipient.id,
      },
      data: {
        electronicConsentAt: new Date(),
      },
    }),
    prisma.documentAuditLog.create({
      data: createDocumentAuditLogData({
        type: DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_CONSENTED,
        envelopeId: recipient.envelopeId,
        user: {
          name: recipient.name,
          email: recipient.email,
        },
        requestMetadata,
        data: {
          recipientEmail: recipient.email,
          recipientId: recipient.id,
          recipientName: recipient.name,
          recipientRole: recipient.role,
          disclosureVersion: ELECTRONIC_CONSENT_DISCLOSURE_VERSION,
        },
      }),
    }),
  ]);

  return updatedRecipient;
};

/**
 * Throws when a recipient attempts a signing action before consenting to
 * conduct the transaction electronically.
 */
export const assertRecipientHasElectronicConsent = (recipient: Pick<Recipient, 'id' | 'electronicConsentAt'>) => {
  if (!recipient.electronicConsentAt) {
    throw new AppError(AppErrorCode.ELECTRONIC_CONSENT_REQUIRED, {
      message: `Recipient ${recipient.id} has not consented to conduct this transaction electronically`,
      userMessage: 'Please agree to sign electronically before continuing.',
    });
  }
};

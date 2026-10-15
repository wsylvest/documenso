import { isBase64Image } from '@documenso/lib/constants/signatures';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { validateFieldAuth } from '@documenso/lib/server-only/document/validate-field-auth';
import { assertRecipientHasElectronicConsent } from '@documenso/lib/server-only/envelope/consent-to-electronic-signing';
import { DOCUMENT_AUDIT_LOG_TYPE } from '@documenso/lib/types/document-audit-logs';
import type { TRecipientActionAuth } from '@documenso/lib/types/document-auth';
import type { RequestMetadata } from '@documenso/lib/universal/extract-request-metadata';
import { createDocumentAuditLogData } from '@documenso/lib/utils/document-audit-logs';
import { extractFieldInsertionValues } from '@documenso/lib/utils/envelope-signing';
import { assertRecipientNotExpired } from '@documenso/lib/utils/recipients';
import { prisma } from '@documenso/prisma';
import type { TSignEnvelopeFieldValue } from '@documenso/trpc/server/envelope-router/sign-envelope-field.types';
import { DocumentStatus, FieldType, RecipientRole, SigningStatus } from '@prisma/client';
import { match } from 'ts-pattern';

export type SignEnvelopeFieldOptions = {
  /**
   * The recipient signing token.
   */
  token: string;
  fieldId: number;
  fieldValue: TSignEnvelopeFieldValue;
  authOptions?: TRecipientActionAuth;

  /**
   * The ID of the signed-in user performing the action, if any. Used to satisfy
   * ACCOUNT action auth. Leave undefined when the caller is an integration
   * acting on behalf of the recipient.
   */
  userId?: number;

  /**
   * The signer's request metadata (IP address and user agent) recorded in the
   * audit log. Callers that proxy the signer, such as API integrations, must
   * forward the signer's real values rather than their own.
   */
  requestMetadata?: RequestMetadata;
};

/**
 * Insert or clear a single field value for the recipient identified by `token`.
 *
 * Shared by the internal signing UI and the public signing API so both record
 * identical audit trails.
 */
export const signEnvelopeField = async ({
  token,
  fieldId,
  fieldValue,
  authOptions,
  userId,
  requestMetadata,
}: SignEnvelopeFieldOptions) => {
  const recipient = await prisma.recipient.findFirst({
    where: {
      token,
    },
  });

  if (!recipient) {
    throw new AppError(AppErrorCode.NOT_FOUND);
  }

  // ESIGN consumer consent must be on record before any field is touched.
  assertRecipientHasElectronicConsent(recipient);

  const field = await prisma.field.findFirst({
    where: {
      id: fieldId,
      recipient:
        recipient.role === RecipientRole.ASSISTANT
          ? {
              signingStatus: {
                not: SigningStatus.SIGNED,
              },
              signingOrder: {
                gte: recipient.signingOrder ?? 0,
              },
              envelopeId: recipient.envelopeId,
            }
          : {
              id: recipient.id,
            },
    },
    include: {
      envelope: {
        include: {
          recipients: true,
          documentMeta: true,
        },
      },
      recipient: true,
    },
  });

  if (!field) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: `Field ${fieldId} not found`,
    });
  }

  const { envelope } = field;
  const { documentMeta } = envelope;

  if (envelope.internalVersion !== 2) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: `Envelope ${envelope.id} is not a version 2 envelope`,
    });
  }

  if (
    field.type === FieldType.SIGNATURE &&
    recipient.id !== field.recipientId &&
    recipient.role === RecipientRole.ASSISTANT
  ) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `Assistant recipients cannot sign signature fields`,
    });
  }

  if (fieldValue.type !== field.type) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'Selected values do not match the field values',
    });
  }

  if (envelope.deletedAt) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `Document ${envelope.id} has been deleted`,
    });
  }

  if (envelope.status !== DocumentStatus.PENDING) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `Document ${envelope.id} must be pending for signing`,
    });
  }

  // Both are checked because an assistant may insert values into a field belonging to
  // another recipient, and neither signing window may have closed. For every other
  // role these reference the same recipient.
  assertRecipientNotExpired(recipient);
  assertRecipientNotExpired(field.recipient);

  if (recipient.signingStatus === SigningStatus.SIGNED || field.recipient.signingStatus === SigningStatus.SIGNED) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `Recipient ${recipient.id} has already signed`,
    });
  }

  if (field.fieldMeta?.readOnly) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `Field ${fieldId} is read only`,
    });
  }

  // Unreachable code based on the above query but we need to satisfy TypeScript
  if (field.recipientId === null) {
    throw new Error(`Field ${fieldId} has no recipientId`);
  }

  const insertionValues = extractFieldInsertionValues({ fieldValue, field, documentMeta });

  // Early return for uninserting fields.
  if (!insertionValues.inserted) {
    return await prisma.$transaction(async (tx) => {
      const updatedField = await tx.field.update({
        where: {
          id: field.id,
        },
        data: {
          customText: '',
          inserted: false,
        },
      });

      await tx.signature.deleteMany({
        where: {
          fieldId: field.id,
        },
      });

      if (recipient.role !== RecipientRole.ASSISTANT) {
        await tx.documentAuditLog.create({
          data: createDocumentAuditLogData({
            type: DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_FIELD_UNINSERTED,
            envelopeId: envelope.id,
            user: {
              name: recipient.name,
              email: recipient.email,
            },
            requestMetadata,
            data: {
              field: field.type,
              fieldId: field.secondaryId,
            },
          }),
        });
      }

      return {
        signedField: updatedField,
      };
    });
  }

  const derivedRecipientActionAuth = await validateFieldAuth({
    documentAuthOptions: envelope.authOptions,
    recipient,
    field,
    userId,
    authOptions,
  });

  const assistant = recipient.role === RecipientRole.ASSISTANT ? recipient : undefined;

  let signatureImageAsBase64 = null;
  let typedSignature = null;

  if (field.type === FieldType.SIGNATURE) {
    if (fieldValue.type !== FieldType.SIGNATURE) {
      throw new AppError(AppErrorCode.INVALID_REQUEST, {
        message: `Field ${fieldId} is not a signature field`,
      });
    }

    if (fieldValue.value) {
      const isBase64 = isBase64Image(fieldValue.value);

      signatureImageAsBase64 = isBase64 ? fieldValue.value : null;
      typedSignature = !isBase64 ? fieldValue.value : null;
    }
  }

  return await prisma.$transaction(async (tx) => {
    const updatedField = await tx.field.update({
      where: {
        id: field.id,
      },
      data: {
        customText: insertionValues.customText,
        inserted: insertionValues.inserted,
      },
      include: {
        signature: true,
      },
    });

    if (field.type === FieldType.SIGNATURE) {
      const signature = await tx.signature.upsert({
        where: {
          fieldId: field.id,
        },
        create: {
          fieldId: field.id,
          recipientId: field.recipientId,
          signatureImageAsBase64: signatureImageAsBase64,
          typedSignature: typedSignature,
        },
        update: {
          signatureImageAsBase64: signatureImageAsBase64,
          typedSignature: typedSignature,
        },
      });

      // Dirty but I don't want to deal with type information
      Object.assign(updatedField, {
        signature,
      });
    }

    await tx.documentAuditLog.create({
      data: createDocumentAuditLogData({
        type:
          assistant && field.recipientId !== assistant.id
            ? DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_FIELD_PREFILLED
            : DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_FIELD_INSERTED,
        envelopeId: envelope.id,
        user: {
          email: assistant?.email ?? recipient.email,
          name: assistant?.name ?? recipient.name,
        },
        requestMetadata,
        data: {
          recipientEmail: recipient.email,
          recipientId: recipient.id,
          recipientName: recipient.name,
          recipientRole: recipient.role,
          fieldId: updatedField.secondaryId,
          field: match(updatedField.type)
            .with(FieldType.SIGNATURE, FieldType.FREE_SIGNATURE, (type) => ({
              type,
              data: signatureImageAsBase64 || typedSignature || '',
            }))
            .with(FieldType.DATE, FieldType.EMAIL, FieldType.NAME, FieldType.TEXT, FieldType.INITIALS, (type) => ({
              type,
              data: updatedField.customText,
            }))
            .with(FieldType.NUMBER, FieldType.RADIO, FieldType.CHECKBOX, FieldType.DROPDOWN, (type) => ({
              type,
              data: updatedField.customText,
            }))
            .exhaustive(),
          fieldSecurity: derivedRecipientActionAuth
            ? {
                type: derivedRecipientActionAuth,
              }
            : undefined,
        },
      }),
    });

    return {
      signedField: updatedField,
    };
  });
};

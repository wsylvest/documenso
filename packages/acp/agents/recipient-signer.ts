import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { completeDocumentWithToken } from '@documenso/lib/server-only/document/complete-document-with-token';
import { rejectDocumentWithToken } from '@documenso/lib/server-only/document/reject-document-with-token';
import { viewedDocument } from '@documenso/lib/server-only/document/viewed-document';
import { getEnvelopeForRecipientSigning } from '@documenso/lib/server-only/envelope/get-envelope-for-recipient-signing';
import { signFieldWithToken } from '@documenso/lib/server-only/field/sign-field-with-token';
import { getRecipientByToken } from '@documenso/lib/server-only/recipient/get-recipient-by-token';
import type { RequestMetadata } from '@documenso/lib/universal/extract-request-metadata';
import { prisma } from '@documenso/prisma';
import { z } from 'zod';

import { JSON_CONTENT_TYPE, jsonPart, TEXT_CONTENT_TYPE, textPart } from '../protocol/messages';
import { asInvalidRequest, getDocumentEnvelopeForPrincipal, summariseEnvelope, summariseRecipient } from './shared';
import type { AcpPrincipal } from './types';
import { defineAgent } from './types';

export const RECIPIENT_SIGNER_CONFIRMATION_AWAIT_TYPE = 'confirmation';

const ZSignerFieldValueSchema = z.object({
  fieldId: z.number().int().positive(),
  value: z.string().describe('The value to insert. For signature fields either typed text or a base64 data URI image.'),
  isBase64: z.boolean().optional().describe('Set when value is a base64 signature image.'),
});

export const ZRecipientSignerInputSchema = z.object({
  token: z.string().min(1).describe('The recipient signing token (the /sign/{token} URL segment).'),
  action: z.enum(['view', 'sign', 'complete', 'reject']).default('sign'),
  fields: z.array(ZSignerFieldValueSchema).optional().describe('Fields to insert when action is "sign".'),
  reason: z.string().max(1000).optional().describe('Rejection reason when action is "reject".'),
  nextSigner: z
    .object({
      email: z.string().email(),
      name: z.string().max(255),
    })
    .optional()
    .describe('Dictate the next signer when the document allows it.'),
  autoComplete: z
    .boolean()
    .default(false)
    .describe('Complete immediately after signing instead of pausing for a human confirmation.'),
  signer: z
    .object({
      ipAddress: z.string().ip().optional(),
      userAgent: z.string().max(1000).optional(),
    })
    .optional()
    .describe('IP address and user agent of the human signer, recorded on the audit log instead of the caller.'),
});

export type TRecipientSignerInput = z.infer<typeof ZRecipientSignerInputSchema>;

export const ZRecipientSignerConfirmationResumeSchema = z.object({
  type: z.literal(RECIPIENT_SIGNER_CONFIRMATION_AWAIT_TYPE),
  decision: z.enum(['complete', 'reject']),
  reason: z.string().max(1000).optional(),
  nextSigner: z.object({ email: z.string().email(), name: z.string().max(255) }).optional(),
});

type RecipientSignerState = {
  envelopeId: string;
  recipientId: number;
  signedFieldIds: number[];
};

/**
 * Resolve the recipient token to an envelope the principal's team owns. The
 * token alone is not enough: an API token must not drive signing for another
 * tenant's recipients.
 */
const resolveRecipientEnvelope = async (principal: AcpPrincipal, token: string) => {
  const recipient = await prisma.recipient.findFirst({
    where: { token },
    select: { id: true, envelopeId: true },
  });

  if (!recipient) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'Recipient not found for the provided token',
      statusCode: 404,
    });
  }

  const envelope = await getDocumentEnvelopeForPrincipal(principal, { type: 'envelopeId', id: recipient.envelopeId });

  return { envelope, recipientId: recipient.id };
};

/**
 * Audit entries record the human signer's IP and user agent when the API
 * caller forwards them, otherwise the caller's own request metadata.
 */
const resolveSignerRequestMetadata = (
  principal: AcpPrincipal,
  signer: TRecipientSignerInput['signer'],
): RequestMetadata => {
  if (!signer || (!signer.ipAddress && !signer.userAgent)) {
    return principal.metadata.requestMetadata;
  }

  return {
    ipAddress: signer.ipAddress ?? principal.metadata.requestMetadata.ipAddress,
    userAgent: signer.userAgent ?? principal.metadata.requestMetadata.userAgent,
  };
};

export const recipientSignerAgent = defineAgent<TRecipientSignerInput, RecipientSignerState>({
  name: 'recipient-signer',
  description:
    'Drive the signing flow for a recipient token on behalf of a human: view the document, insert field values, ' +
    'pause for the signer to confirm, then complete or reject the document.',
  inputSchema: ZRecipientSignerInputSchema,
  inputContentTypes: [JSON_CONTENT_TYPE, TEXT_CONTENT_TYPE],
  outputContentTypes: [JSON_CONTENT_TYPE, TEXT_CONTENT_TYPE],
  metadata: {
    tags: ['documenso', 'signing', 'recipient', 'human-in-the-loop'],
    capabilities: [
      { name: 'view', description: 'Record the document as viewed and return the fields to complete' },
      { name: 'sign', description: 'Insert values into the recipient fields' },
      { name: 'confirmation', description: 'Await the human signer confirmation before completing' },
      { name: 'complete', description: 'Complete signing for the recipient' },
      { name: 'reject', description: 'Reject the document with a reason' },
    ],
    awaitTypes: [RECIPIENT_SIGNER_CONFIRMATION_AWAIT_TYPE],
  },
  step: async ({ input, principal, state, resume, logger, progress }) => {
    const { token } = input;

    const { envelope, recipientId } = await resolveRecipientEnvelope(principal, token);

    const requestMetadata = resolveSignerRequestMetadata(principal, input.signer);

    const envelopeId = { type: 'envelopeId' as const, id: envelope.id };

    const finish = async (summary: string, extra: Record<string, unknown> = {}) => {
      const latest = await getDocumentEnvelopeForPrincipal(principal, envelopeId);
      const recipient = latest.recipients.find((candidate) => candidate.id === recipientId);

      return {
        type: 'completed' as const,
        output: [
          textPart(summary, 'summary'),
          jsonPart('result', {
            ...summariseEnvelope(latest),
            recipient: recipient ? summariseRecipient(recipient) : null,
            ...extra,
          }),
        ],
      };
    };

    const complete = async (nextSigner?: TRecipientSignerInput['nextSigner']) => {
      await completeDocumentWithToken({
        token,
        id: envelopeId,
        requestMetadata,
        nextSigner,
      });

      logger.info({ msg: 'ACP recipient-signer completed', envelopeId: envelope.id, recipientId });

      return await finish('Recipient signing completed.', { action: 'complete' });
    };

    const reject = async (reason: string) => {
      await rejectDocumentWithToken({
        token,
        id: envelopeId,
        reason,
        requestMetadata,
      });

      logger.info({ msg: 'ACP recipient-signer rejected', envelopeId: envelope.id, recipientId });

      return await finish(`Document rejected: ${reason}`, { action: 'reject', reason });
    };

    if (resume) {
      const decision = ZRecipientSignerConfirmationResumeSchema.safeParse(resume);

      if (!decision.success) {
        throw new AppError(AppErrorCode.INVALID_BODY, {
          message: 'Resume payload must be { "type": "confirmation", "decision": "complete" | "reject", "reason"? }',
          statusCode: 400,
        });
      }

      if (decision.data.decision === 'reject') {
        return await reject(decision.data.reason ?? 'Rejected by signer');
      }

      return await complete(decision.data.nextSigner ?? input.nextSigner);
    }

    if (input.action === 'reject') {
      return await reject(input.reason ?? 'Rejected by signer');
    }

    if (input.action === 'complete') {
      return await complete(input.nextSigner);
    }

    await viewedDocument({ token, requestMetadata });

    const signing = await getEnvelopeForRecipientSigning({ token });

    if (input.action === 'view') {
      return await finish(`"${envelope.title}" viewed; ${signing.recipient.fields.length} field(s) assigned.`, {
        action: 'view',
        isRecipientsTurn: signing.isRecipientsTurn,
        fields: signing.recipient.fields.map(summariseField),
      });
    }

    const signedFieldIds = [...(state?.signedFieldIds ?? [])];

    for (const field of input.fields ?? []) {
      if (signedFieldIds.includes(field.fieldId)) {
        continue;
      }

      try {
        await signFieldWithToken({
          token,
          fieldId: field.fieldId,
          value: field.value,
          isBase64: field.isBase64,
          requestMetadata,
        });
      } catch (error) {
        asInvalidRequest(error);
      }

      signedFieldIds.push(field.fieldId);

      await progress('Field signed', { fieldId: field.fieldId });
    }

    const recipient = await getRecipientByToken({ token });

    const remainingRequired = recipient.fields.filter((field) => !field.inserted && field.fieldMeta?.required);
    const remaining = recipient.fields.filter((field) => !field.inserted);

    if (input.autoComplete && remainingRequired.length === 0) {
      return await complete(input.nextSigner);
    }

    return {
      type: 'awaiting',
      state: { envelopeId: envelope.id, recipientId, signedFieldIds },
      awaitRequest: {
        type: RECIPIENT_SIGNER_CONFIRMATION_AWAIT_TYPE,
        message: {
          role: 'agent/recipient-signer',
          parts: [
            textPart(
              `${signedFieldIds.length} field(s) signed on "${envelope.title}"; ${remaining.length} field(s) remain ` +
                `(${remainingRequired.length} required). Resume with ` +
                `{ "type": "confirmation", "decision": "complete" | "reject", "reason"? } to finish.`,
              'prompt',
            ),
            jsonPart('pending', {
              ...summariseEnvelope(envelope),
              recipientId,
              signedFieldIds,
              remainingFields: remaining.map(summariseField),
              canComplete: remainingRequired.length === 0,
            }),
          ],
        },
      },
    };
  },
});

type FieldLike = {
  id: number;
  type: string;
  page: number;
  inserted: boolean;
  customText: string;
  fieldMeta: { label?: string; required?: boolean } | null;
};

const summariseField = (field: FieldLike) => ({
  id: field.id,
  type: field.type,
  page: field.page,
  inserted: field.inserted,
  label: field.fieldMeta?.label ?? null,
  required: field.fieldMeta?.required ?? false,
});

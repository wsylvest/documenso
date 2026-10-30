import { resendDocument } from '@documenso/lib/server-only/document/resend-document';
import { DocumentStatus } from '@prisma/client';
import { z } from 'zod';

import { JSON_CONTENT_TYPE, jsonPart, TEXT_CONTENT_TYPE, textPart } from '../protocol/messages';
import {
  getDocumentEnvelopeForPrincipal,
  isPendingRecipient,
  summariseEnvelope,
  summariseRecipient,
  toEnvelopeIdOptions,
  ZEnvelopeReferenceSchema,
} from './shared';
import { defineAgent } from './types';

export const ZSigningStatusInputSchema = ZEnvelopeReferenceSchema.extend({
  remind: z
    .union([z.boolean(), z.array(z.number().int().positive())])
    .optional()
    .describe('Send a reminder to every pending recipient (true) or to the listed recipient IDs.'),
});

export type TSigningStatusInput = z.infer<typeof ZSigningStatusInputSchema>;

export const signingStatusAgent = defineAgent<TSigningStatusInput, null>({
  name: 'signing-status',
  description:
    'Report the signing status of a document: envelope status, every recipient with their signing, send and read ' +
    'status, the recipients still pending, and optionally resend signing reminders to them.',
  inputSchema: ZSigningStatusInputSchema,
  inputContentTypes: [JSON_CONTENT_TYPE, TEXT_CONTENT_TYPE],
  outputContentTypes: [JSON_CONTENT_TYPE, TEXT_CONTENT_TYPE],
  metadata: {
    tags: ['documenso', 'signing', 'status'],
    capabilities: [
      { name: 'status', description: 'Return envelope and recipient status' },
      { name: 'remind', description: 'Resend signing invitations to pending recipients' },
    ],
  },
  step: async ({ input, principal, logger }) => {
    const id = toEnvelopeIdOptions(input);

    let envelope = await getDocumentEnvelopeForPrincipal(principal, id);

    const pendingRecipientIds = envelope.recipients.filter(isPendingRecipient).map((recipient) => recipient.id);

    let remindedRecipientIds: number[] = [];

    if (input.remind && envelope.status === DocumentStatus.PENDING) {
      const requested = input.remind === true ? pendingRecipientIds : input.remind;

      remindedRecipientIds = requested.filter((recipientId) => pendingRecipientIds.includes(recipientId));

      if (remindedRecipientIds.length > 0) {
        logger.info({ msg: 'ACP signing-status sending reminders', envelopeId: envelope.id, remindedRecipientIds });

        await resendDocument({
          id: { type: 'envelopeId', id: envelope.id },
          userId: principal.user.id,
          teamId: principal.teamId,
          recipients: remindedRecipientIds,
          requestMetadata: principal.metadata,
        });

        envelope = await getDocumentEnvelopeForPrincipal(principal, id);
      }
    }

    const result = {
      ...summariseEnvelope(envelope),
      recipients: envelope.recipients.map(summariseRecipient),
      pendingRecipientIds,
      remindedRecipientIds,
    };

    const pendingNames = envelope.recipients
      .filter((recipient) => pendingRecipientIds.includes(recipient.id))
      .map((recipient) => recipient.email);

    const summary =
      pendingNames.length === 0
        ? `"${envelope.title}" is ${envelope.status}; no recipients are pending.`
        : `"${envelope.title}" is ${envelope.status}; waiting on ${pendingNames.join(', ')}.` +
          (remindedRecipientIds.length > 0 ? ` Reminders sent to ${remindedRecipientIds.length} recipient(s).` : '');

    return {
      type: 'completed',
      output: [textPart(summary, 'summary'), jsonPart('result', result)],
    };
  },
});

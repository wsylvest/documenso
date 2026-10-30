import {
  ZCompleteSigningRequestSchema,
  ZCompleteSigningResponseSchema,
} from '@documenso/trpc/server/signing-router/complete-signing.types';
import {
  ZConsentSigningRequestSchema,
  ZConsentSigningResponseSchema,
} from '@documenso/trpc/server/signing-router/consent-signing.types';
import {
  ZGetSigningEnvelopeRequestSchema,
  ZGetSigningEnvelopeResponseSchema,
} from '@documenso/trpc/server/signing-router/get-signing-envelope.types';
import {
  ZGetSigningStatusRequestSchema,
  ZGetSigningStatusResponseSchema,
} from '@documenso/trpc/server/signing-router/get-signing-status.types';
import {
  ZRejectSigningRequestSchema,
  ZRejectSigningResponseSchema,
} from '@documenso/trpc/server/signing-router/reject-signing.types';
import {
  ZSignSigningFieldRequestSchema,
  ZSignSigningFieldResponseSchema,
} from '@documenso/trpc/server/signing-router/sign-signing-field.types';
import {
  ZViewSigningEnvelopeRequestSchema,
  ZViewSigningEnvelopeResponseSchema,
} from '@documenso/trpc/server/signing-router/view-signing-envelope.types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { McpToolContext } from '../context';
import { defineTool, TOOL_ANNOTATIONS } from '../define-tool';
import { ZConfirmSchema } from './envelopes';

/**
 * The complete response is a discriminated union; wrap it so the output schema
 * is an object as MCP requires.
 */
export const ZSigningCompleteOutputSchema = z.object({
  status: z.enum(['SIGNED', 'ALREADY_SIGNED', 'REDIRECT']),
  redirectUrl: z.string().optional(),
});

const SIGNING_NOTE =
  "Part of the native Signing API: drives the recipient signing flow for a recipient of one of this team's documents, identified by the recipient signing token (from distribute_envelope or the signing URL). Pass signer.ipAddress / signer.userAgent when acting on behalf of a person so the audit trail records them.";

export const registerSigningTools = (server: McpServer, ctx: McpToolContext) => {
  defineTool(server, ctx, {
    name: 'signing_get_envelope',
    title: 'Signing: get envelope for recipient',
    description: `Return everything needed to render a signing experience for the recipient identified by the token: the document, its files (with token-authorised download URLs), the recipient's fields, other recipients, whether it is this recipient's turn, and signing options. ${SIGNING_NOTE}`,
    inputSchema: ZGetSigningEnvelopeRequestSchema,
    outputSchema: ZGetSigningEnvelopeResponseSchema,
    annotations: TOOL_ANNOTATIONS.readOnly,
    handler: async (input) => {
      const result = await ctx.caller.signing.getEnvelope(input);

      const fields = result.recipient.fields
        .map((field) => `- field ${field.id}: ${field.type}${field.inserted ? ' (done)' : ''}`)
        .join('\n');

      return {
        structured: result,
        text: `${result.envelope.title}: recipient ${result.recipient.email}, turn: ${result.isRecipientsTurn}\n${fields}`,
      };
    },
  });

  defineTool(server, ctx, {
    name: 'signing_get_status',
    title: 'Signing: get status',
    description: `Return the overall signing status (PENDING, PROCESSING, COMPLETED, REJECTED) of the document the signing token belongs to. ${SIGNING_NOTE}`,
    inputSchema: ZGetSigningStatusRequestSchema,
    outputSchema: ZGetSigningStatusResponseSchema,
    annotations: TOOL_ANNOTATIONS.readOnly,
    handler: async (input) => {
      const result = await ctx.caller.signing.getStatus(input);

      return { structured: result, text: `Status: ${result.status}` };
    },
  });

  defineTool(server, ctx, {
    name: 'signing_view',
    title: 'Signing: record document viewed',
    description: `Record that the recipient opened the document (audit entry, read status, DOCUMENT_OPENED webhook). Call once when the signer first sees the document. ${SIGNING_NOTE}`,
    inputSchema: ZViewSigningEnvelopeRequestSchema,
    outputSchema: ZViewSigningEnvelopeResponseSchema,
    annotations: TOOL_ANNOTATIONS.update,
    handler: async (input) => {
      const result = await ctx.caller.signing.view(input);

      return { structured: result, text: 'Recorded view' };
    },
  });

  defineTool(server, ctx, {
    name: 'signing_consent',
    title: 'Signing: record electronic consent',
    description: `Record the recipient's affirmative consent to sign electronically (ESIGN consumer disclosure). Must be called, after the signer has been shown the disclosure and agreed, before signing fields or completing. Idempotent. ${SIGNING_NOTE}`,
    inputSchema: ZConsentSigningRequestSchema,
    outputSchema: ZConsentSigningResponseSchema,
    annotations: TOOL_ANNOTATIONS.update,
    handler: async (input) => {
      const result = await ctx.caller.signing.consent(input);

      return { structured: result, text: `Consent recorded at ${result.electronicConsentAt.toISOString()}` };
    },
  });

  defineTool(server, ctx, {
    name: 'signing_sign_field',
    title: 'Signing: sign a field',
    description: `Insert (or clear with a null value) the value of one of the recipient's fields. For SIGNATURE fields pass a typed name or a base64 data URL image. Repeat per field, then call signing_complete. ${SIGNING_NOTE}`,
    inputSchema: ZSignSigningFieldRequestSchema,
    outputSchema: ZSignSigningFieldResponseSchema,
    annotations: TOOL_ANNOTATIONS.update,
    identifiers: (input) => ({ fieldId: input.fieldId }),
    handler: async (input) => {
      const result = await ctx.caller.signing.signField(input);

      return {
        structured: result,
        text: `Field ${result.signedField.id} (${result.signedField.type}) ${result.signedField.inserted ? 'signed' : 'cleared'}`,
      };
    },
  });

  defineTool(server, ctx, {
    name: 'signing_complete',
    title: 'Signing: complete',
    description: `Finalise signing for the recipient once every required field is inserted. Returns SIGNED, ALREADY_SIGNED, or REDIRECT with a URL when the signer must finish with a trust service provider (AES/QES). ${SIGNING_NOTE}`,
    inputSchema: ZCompleteSigningRequestSchema,
    outputSchema: ZSigningCompleteOutputSchema,
    annotations: TOOL_ANNOTATIONS.create,
    handler: async (input) => {
      const result = ZCompleteSigningResponseSchema.parse(await ctx.caller.signing.complete(input));

      return {
        structured: {
          status: result.status,
          redirectUrl: result.status === 'REDIRECT' ? result.redirectUrl : undefined,
        },
        text: result.status === 'REDIRECT' ? `Continue signing at ${result.redirectUrl}` : `Result: ${result.status}`,
      };
    },
  });

  defineTool(server, ctx, {
    name: 'signing_reject',
    title: 'Signing: reject document',
    description: `Reject the document on behalf of the recipient with a reason. The document moves to REJECTED and the owner is notified. Cannot be undone; requires confirm: true after the signer explicitly chose to reject. ${SIGNING_NOTE}`,
    inputSchema: ZRejectSigningRequestSchema.extend({ confirm: ZConfirmSchema }),
    outputSchema: ZRejectSigningResponseSchema,
    annotations: TOOL_ANNOTATIONS.destructive,
    handler: async ({ confirm: _confirm, ...input }) => {
      const result = await ctx.caller.signing.reject(input);

      return { structured: result, text: 'Document rejected' };
    },
  });
};

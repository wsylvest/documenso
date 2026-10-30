import { ZDocumentAuditLogBaseSchema } from '@documenso/lib/types/document-audit-logs';
import { ZFindResultResponse, ZFindSearchParamsSchema } from '@documenso/lib/types/search-params';
import {
  ZCancelEnvelopeRequestSchema,
  ZCancelEnvelopeResponseSchema,
} from '@documenso/trpc/server/envelope-router/cancel-envelope.types';
import {
  ZDeleteEnvelopeRequestSchema,
  ZDeleteEnvelopeResponseSchema,
} from '@documenso/trpc/server/envelope-router/delete-envelope.types';
import { ZFindEnvelopeAuditLogsRequestSchema } from '@documenso/trpc/server/envelope-router/find-envelope-audit-logs.types';
import { ZFindEnvelopesResponseSchema } from '@documenso/trpc/server/envelope-router/find-envelopes.types';
import { ZGetEnvelopeResponseSchema } from '@documenso/trpc/server/envelope-router/get-envelope.types';
import {
  ZUpdateEnvelopeRequestSchema,
  ZUpdateEnvelopeResponseSchema,
} from '@documenso/trpc/server/envelope-router/update-envelope.types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DocumentSource, DocumentStatus, EnvelopeType } from '@prisma/client';
import { z } from 'zod';

import type { McpToolContext } from '../context';
import { defineTool, TOOL_ANNOTATIONS } from '../define-tool';

export const ZEnvelopeIdSchema = z
  .string()
  .min(1)
  .describe('The envelope ID (starts with "envelope_"). Documents and templates are both envelopes.');

/**
 * Explicit confirmation required by destructive tools. A literal `true` means a
 * client cannot satisfy the schema by accident.
 */
export const ZConfirmSchema = z
  .literal(true)
  .describe(
    'Must be true. Only set this after the user has explicitly confirmed the action in this conversation; never assume consent.',
  );

export const ZListEnvelopesInputSchema = ZFindSearchParamsSchema.extend({
  type: z
    .nativeEnum(EnvelopeType)
    .optional()
    .describe('Filter by envelope type. Omit to return both documents and templates.'),
  status: z
    .nativeEnum(DocumentStatus)
    .optional()
    .describe(
      'Filter documents by status: DRAFT, PENDING (sent, awaiting signatures), COMPLETED, REJECTED, CANCELLED.',
    ),
  source: z.nativeEnum(DocumentSource).optional().describe('Filter by how the envelope was created.'),
  templateId: z.number().optional().describe('Legacy numeric template ID the documents were created from.'),
  folderId: z.string().optional().describe('Only return envelopes inside this folder.'),
  hasExpiredRecipients: z
    .boolean()
    .optional()
    .describe('When true only return envelopes where at least one signing link has expired.'),
  orderByDirection: z.enum(['asc', 'desc']).default('desc').describe('Sort by creation date.'),
});

/**
 * The audit log entry schema is an intersection with a large union, which
 * converts to a JSON schema (allOf + additionalProperties: false) that no
 * value can satisfy. Describe the common fields and let the event `data` through.
 */
export const ZEnvelopeAuditLogsOutputSchema = ZFindResultResponse.extend({
  data: ZDocumentAuditLogBaseSchema.extend({
    type: z.string().describe('The audit event type, e.g. DOCUMENT_SENT, DOCUMENT_FIELD_INSERTED.'),
    data: z.unknown().describe('Event specific details.'),
  })
    .passthrough()
    .array(),
});

const summariseEnvelopes = (envelopes: Array<{ id: string; title: string; status: string; type: string }>) =>
  envelopes.length === 0
    ? 'No envelopes matched.'
    : envelopes
        .map((envelope) => `${envelope.id} | ${envelope.type} | ${envelope.status} | ${envelope.title}`)
        .join('\n');

export const registerEnvelopeTools = (server: McpServer, ctx: McpToolContext) => {
  defineTool(server, ctx, {
    name: 'list_envelopes',
    title: 'List envelopes',
    description:
      "Search the team's envelopes (documents and templates). Supports a free text query on the title, status and folder filters, and pagination (perPage max 100). Returns summaries; use get_envelope for recipients and fields.",
    inputSchema: ZListEnvelopesInputSchema,
    outputSchema: ZFindEnvelopesResponseSchema,
    annotations: TOOL_ANNOTATIONS.readOnly,
    identifiers: (input) => ({ folderId: input.folderId }),
    handler: async (input) => {
      const { hasExpiredRecipients, ...rest } = input;

      const result = await ctx.caller.envelope.find({
        ...rest,
        hasExpiredRecipients: hasExpiredRecipients === undefined ? undefined : hasExpiredRecipients ? 'true' : 'false',
      });

      return {
        structured: result,
        text: `${result.count} envelope(s), page ${result.currentPage}/${result.totalPages}\n${summariseEnvelopes(result.data)}`,
      };
    },
  });

  defineTool(server, ctx, {
    name: 'get_envelope',
    title: 'Get envelope',
    description:
      'Return a document or template envelope with its status, settings, recipients (including signing status and role) and fields. Use this to check signing progress.',
    inputSchema: z.object({ envelopeId: ZEnvelopeIdSchema }),
    outputSchema: ZGetEnvelopeResponseSchema,
    annotations: TOOL_ANNOTATIONS.readOnly,
    identifiers: (input) => ({ envelopeId: input.envelopeId }),
    handler: async ({ envelopeId }) => {
      const envelope = await ctx.caller.envelope.get({ envelopeId });

      const recipients = envelope.recipients
        .map(
          (recipient) =>
            `- ${recipient.name || recipient.email} <${recipient.email}> ${recipient.role}: ${recipient.signingStatus}`,
        )
        .join('\n');

      return {
        structured: envelope,
        text: `${envelope.title} (${envelope.type}, ${envelope.status})\nRecipients:\n${recipients || '- none'}\nFields: ${envelope.fields.length}`,
      };
    },
  });

  defineTool(server, ctx, {
    name: 'get_envelope_audit_logs',
    title: 'Get envelope audit logs',
    description:
      'List the audit trail entries of a document (created, sent, viewed, signed, completed, ...) with timestamps, actors and connection details. Paginated.',
    inputSchema: ZFindEnvelopeAuditLogsRequestSchema.extend({ envelopeId: ZEnvelopeIdSchema }),
    outputSchema: ZEnvelopeAuditLogsOutputSchema,
    annotations: TOOL_ANNOTATIONS.readOnly,
    identifiers: (input) => ({ envelopeId: input.envelopeId }),
    handler: async (input) => {
      const result = await ctx.caller.envelope.auditLog.find(input);

      return { structured: result };
    },
  });

  defineTool(server, ctx, {
    name: 'update_envelope',
    title: 'Update envelope',
    description:
      'Update the title, external ID, visibility, folder, authentication requirements or email/signing settings (subject, message, language, timezone, date format, redirect URL) of an envelope. Only drafts can be fully edited.',
    inputSchema: ZUpdateEnvelopeRequestSchema.extend({ envelopeId: ZEnvelopeIdSchema }),
    outputSchema: ZUpdateEnvelopeResponseSchema,
    annotations: TOOL_ANNOTATIONS.update,
    identifiers: (input) => ({ envelopeId: input.envelopeId }),
    handler: async (input) => {
      const envelope = await ctx.caller.envelope.update(input);

      return { structured: envelope, text: `Updated ${envelope.id}: ${envelope.title}` };
    },
  });

  defineTool(server, ctx, {
    name: 'cancel_envelope',
    title: 'Cancel envelope',
    description:
      'Cancel a pending document so recipients can no longer sign it. Recipients are notified. This cannot be undone; requires confirm: true after the user explicitly agreed.',
    inputSchema: ZCancelEnvelopeRequestSchema.extend({
      envelopeId: ZEnvelopeIdSchema,
      confirm: ZConfirmSchema,
    }),
    outputSchema: ZCancelEnvelopeResponseSchema,
    annotations: TOOL_ANNOTATIONS.destructive,
    identifiers: (input) => ({ envelopeId: input.envelopeId }),
    handler: async ({ envelopeId, reason }) => {
      const result = await ctx.caller.envelope.cancel({ envelopeId, reason });

      return { structured: result, text: `Cancelled ${envelopeId}` };
    },
  });

  defineTool(server, ctx, {
    name: 'delete_envelope',
    title: 'Delete envelope',
    description:
      'Delete a document or template. Pending documents are cancelled and recipients notified; drafts and templates are removed. This cannot be undone; requires confirm: true after the user explicitly agreed.',
    inputSchema: ZDeleteEnvelopeRequestSchema.extend({
      envelopeId: ZEnvelopeIdSchema,
      confirm: ZConfirmSchema,
    }),
    outputSchema: ZDeleteEnvelopeResponseSchema,
    annotations: TOOL_ANNOTATIONS.destructive,
    identifiers: (input) => ({ envelopeId: input.envelopeId }),
    handler: async ({ envelopeId }) => {
      const result = await ctx.caller.envelope.delete({ envelopeId });

      return { structured: result, text: `Deleted ${envelopeId}` };
    },
  });
};

import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { ZFieldMetaPrefillFieldsSchema } from '@documenso/lib/types/field-meta';
import { ZFindSearchParamsSchema } from '@documenso/lib/types/search-params';
import { ZFindEnvelopesResponseSchema } from '@documenso/trpc/server/envelope-router/find-envelopes.types';
import { ZGetEnvelopeResponseSchema } from '@documenso/trpc/server/envelope-router/get-envelope.types';
import { ZRecipientWithSigningUrlSchema } from '@documenso/trpc/server/envelope-router/schema';
import { ZUseEnvelopePayloadSchema } from '@documenso/trpc/server/envelope-router/use-envelope.types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { EnvelopeType } from '@prisma/client';
import { z } from 'zod';

import type { McpToolContext } from '../context';
import { defineTool, TOOL_ANNOTATIONS } from '../define-tool';
import { ZEnvelopeIdSchema } from './envelopes';

export const ZListTemplatesInputSchema = ZFindSearchParamsSchema.extend({
  folderId: z.string().optional().describe('Only return templates inside this folder.'),
});

export const ZCreateDocumentFromTemplateInputSchema = z.object({
  templateId: ZEnvelopeIdSchema.describe('The envelope ID of the template to use.'),
  recipients: z
    .array(
      z.object({
        id: z.number().describe('The ID of the placeholder recipient in the template (see get_template).'),
        email: z.string().email().describe('Email address of the real recipient.'),
        name: z.string().max(255).optional().describe('Full name of the real recipient.'),
        signingOrder: z.number().optional(),
      }),
    )
    .optional()
    .describe(
      'Map each template recipient to a real person. Template recipients that are not mapped keep their placeholder details.',
    ),
  title: z.string().min(1).max(255).optional().describe('Title for the new document. Defaults to the template title.'),
  subject: z.string().max(255).optional().describe('Email subject override.'),
  message: z.string().max(5000).optional().describe('Email message override.'),
  externalId: z.string().optional().describe('Your own reference, e.g. a CRM job number.'),
  folderId: z.string().optional().describe('Folder to create the document in.'),
  prefillFields: z
    .array(ZFieldMetaPrefillFieldsSchema)
    .optional()
    .describe('Pre-fill text, number, checkbox, radio or dropdown fields by field ID before sending.'),
  distribute: z
    .boolean()
    .default(false)
    .describe(
      'When true the document is sent to the recipients immediately (emails go out). When false it is created as a draft that can be reviewed and sent with distribute_envelope.',
    ),
});

export const ZCreateDocumentFromTemplateOutputSchema = z.object({
  envelopeId: z.string(),
  distributed: z.boolean(),
  recipients: ZRecipientWithSigningUrlSchema.array(),
});

export const registerTemplateTools = (server: McpServer, ctx: McpToolContext) => {
  defineTool(server, ctx, {
    name: 'list_templates',
    title: 'List templates',
    description:
      "List the team's templates, optionally filtered by a title search query or folder. Use get_template to see a template's placeholder recipients (needed for create_document_from_template).",
    inputSchema: ZListTemplatesInputSchema,
    outputSchema: ZFindEnvelopesResponseSchema,
    annotations: TOOL_ANNOTATIONS.readOnly,
    identifiers: (input) => ({ folderId: input.folderId }),
    handler: async (input) => {
      const result = await ctx.caller.envelope.find({
        ...input,
        type: EnvelopeType.TEMPLATE,
        orderByDirection: 'desc',
      });

      const lines = result.data.map((template) => `${template.id} | ${template.title}`).join('\n');

      return {
        structured: result,
        text: `${result.count} template(s)\n${lines || 'No templates found.'}`,
      };
    },
  });

  defineTool(server, ctx, {
    name: 'get_template',
    title: 'Get template',
    description:
      'Return a template with its placeholder recipients (their IDs are needed to map real signers) and fields.',
    inputSchema: z.object({ templateId: ZEnvelopeIdSchema }),
    outputSchema: ZGetEnvelopeResponseSchema,
    annotations: TOOL_ANNOTATIONS.readOnly,
    identifiers: (input) => ({ templateId: input.templateId }),
    handler: async ({ templateId }) => {
      const envelope = await ctx.caller.envelope.get({ envelopeId: templateId });

      if (envelope.type !== EnvelopeType.TEMPLATE) {
        throw new AppError(AppErrorCode.NOT_FOUND, {
          message: `${templateId} is a document, not a template. Use get_envelope instead.`,
          statusCode: 404,
        });
      }

      const recipients = envelope.recipients
        .map(
          (recipient) =>
            `- id ${recipient.id}: ${recipient.name || '(unnamed)'} <${recipient.email}> ${recipient.role}`,
        )
        .join('\n');

      return {
        structured: envelope,
        text: `${envelope.title}\nPlaceholder recipients:\n${recipients || '- none'}\nFields: ${envelope.fields.length}`,
      };
    },
  });

  defineTool(server, ctx, {
    name: 'create_document_from_template',
    title: 'Create document from template',
    description:
      'Create a new document from a template, replacing the placeholder recipients with real people. Set distribute: true to send it straight away, otherwise a draft is created. Returns the new envelope ID and, when distributed, each recipient signing URL.',
    inputSchema: ZCreateDocumentFromTemplateInputSchema,
    outputSchema: ZCreateDocumentFromTemplateOutputSchema,
    annotations: TOOL_ANNOTATIONS.createOpenWorld,
    identifiers: (input) => ({ templateId: input.templateId, folderId: input.folderId }),
    handler: async (input) => {
      const { templateId, recipients, title, subject, message, externalId, folderId, prefillFields, distribute } =
        input;

      const override = title || subject || message ? { title, subject, message } : undefined;

      const payload = ZUseEnvelopePayloadSchema.parse({
        envelopeId: templateId,
        recipients,
        externalId,
        folderId,
        prefillFields,
        distributeDocument: distribute,
        override,
      });

      const result = await ctx.caller.envelope.use({ payload, files: [] });

      const lines = result.recipients
        .map((recipient) => `- ${recipient.name || recipient.email} <${recipient.email}>: ${recipient.signingUrl}`)
        .join('\n');

      return {
        structured: {
          envelopeId: result.id,
          distributed: distribute,
          recipients: result.recipients,
        },
        text: distribute
          ? `Created and sent ${result.id}\n${lines}`
          : `Created draft ${result.id}. Review it, then call distribute_envelope to send it.`,
      };
    },
  });
};

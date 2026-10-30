import {
  ZCreateEnvelopeFieldsRequestSchema,
  ZCreateEnvelopeFieldsResponseSchema,
} from '@documenso/trpc/server/envelope-router/envelope-fields/create-envelope-fields.types';
import {
  ZUpdateEnvelopeFieldsRequestSchema,
  ZUpdateEnvelopeFieldsResponseSchema,
} from '@documenso/trpc/server/envelope-router/envelope-fields/update-envelope-fields.types';
import {
  ZCreateEnvelopeRecipientsRequestSchema,
  ZCreateEnvelopeRecipientsResponseSchema,
} from '@documenso/trpc/server/envelope-router/envelope-recipients/create-envelope-recipients.types';
import {
  ZUpdateEnvelopeRecipientsRequestSchema,
  ZUpdateEnvelopeRecipientsResponseSchema,
} from '@documenso/trpc/server/envelope-router/envelope-recipients/update-envelope-recipients.types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { McpToolContext } from '../context';
import { defineTool, TOOL_ANNOTATIONS } from '../define-tool';
import { ZEnvelopeIdSchema } from './envelopes';

export const registerRecipientAndFieldTools = (server: McpServer, ctx: McpToolContext) => {
  defineTool(server, ctx, {
    name: 'add_recipients',
    title: 'Add recipients',
    description:
      'Add one or more recipients (SIGNER, APPROVER, VIEWER, CC or ASSISTANT) to a draft document or template. Returns the created recipients with their IDs, which are needed to add fields.',
    inputSchema: ZCreateEnvelopeRecipientsRequestSchema.extend({ envelopeId: ZEnvelopeIdSchema }),
    outputSchema: ZCreateEnvelopeRecipientsResponseSchema,
    annotations: TOOL_ANNOTATIONS.create,
    identifiers: (input) => ({ envelopeId: input.envelopeId }),
    handler: async (input) => {
      const result = await ctx.caller.envelope.recipient.createMany(input);

      const lines = result.data
        .map(
          (recipient) =>
            `- id ${recipient.id}: ${recipient.name || recipient.email} <${recipient.email}> ${recipient.role}`,
        )
        .join('\n');

      return { structured: result, text: `Added ${result.data.length} recipient(s)\n${lines}` };
    },
  });

  defineTool(server, ctx, {
    name: 'update_recipients',
    title: 'Update recipients',
    description: 'Update the name, email, role, signing order or authentication of existing recipients by ID.',
    inputSchema: ZUpdateEnvelopeRecipientsRequestSchema.extend({ envelopeId: ZEnvelopeIdSchema }),
    outputSchema: ZUpdateEnvelopeRecipientsResponseSchema,
    annotations: TOOL_ANNOTATIONS.update,
    identifiers: (input) => ({ envelopeId: input.envelopeId }),
    handler: async (input) => {
      const result = await ctx.caller.envelope.recipient.updateMany(input);

      return { structured: result, text: `Updated ${result.data.length} recipient(s)` };
    },
  });

  defineTool(server, ctx, {
    name: 'add_fields',
    title: 'Add fields',
    description:
      'Place fields (SIGNATURE, INITIALS, NAME, EMAIL, DATE, TEXT, NUMBER, CHECKBOX, RADIO, DROPDOWN) for recipients on a draft document or template. Position each field either with page + percentage coordinates (positionX/positionY/width/height are percentages of the page) or with a text placeholder found in the PDF such as "{{signature}}". Every SIGNER needs at least one SIGNATURE field before the envelope can be sent.',
    inputSchema: ZCreateEnvelopeFieldsRequestSchema.extend({ envelopeId: ZEnvelopeIdSchema }),
    outputSchema: ZCreateEnvelopeFieldsResponseSchema,
    annotations: TOOL_ANNOTATIONS.create,
    identifiers: (input) => ({ envelopeId: input.envelopeId }),
    handler: async (input) => {
      const result = await ctx.caller.envelope.field.createMany(input);

      const lines = result.data
        .map((field) => `- id ${field.id}: ${field.type} for recipient ${field.recipientId} on page ${field.page}`)
        .join('\n');

      return { structured: result, text: `Added ${result.data.length} field(s)\n${lines}` };
    },
  });

  defineTool(server, ctx, {
    name: 'update_fields',
    title: 'Update fields',
    description: 'Update the type, position, size or settings of existing fields by ID.',
    inputSchema: ZUpdateEnvelopeFieldsRequestSchema.extend({ envelopeId: ZEnvelopeIdSchema }),
    outputSchema: ZUpdateEnvelopeFieldsResponseSchema,
    annotations: TOOL_ANNOTATIONS.update,
    identifiers: (input) => ({ envelopeId: input.envelopeId }),
    handler: async (input) => {
      const result = await ctx.caller.envelope.field.updateMany(input);

      return { structured: result, text: `Updated ${result.data.length} field(s)` };
    },
  });
};

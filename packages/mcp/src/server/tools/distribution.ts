import {
  ZDistributeEnvelopeRequestSchema,
  ZDistributeEnvelopeResponseSchema,
} from '@documenso/trpc/server/envelope-router/distribute-envelope.types';
import {
  ZRedistributeEnvelopeRequestSchema,
  ZRedistributeEnvelopeResponseSchema,
} from '@documenso/trpc/server/envelope-router/redistribute-envelope.types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { McpToolContext } from '../context';
import { defineTool, TOOL_ANNOTATIONS } from '../define-tool';
import { ZEnvelopeIdSchema } from './envelopes';

const summariseSigningUrls = (recipients: Array<{ name: string; email: string; signingUrl: string }>) =>
  recipients
    .map((recipient) => `- ${recipient.name || recipient.email} <${recipient.email}>: ${recipient.signingUrl}`)
    .join('\n');

export const registerDistributionTools = (server: McpServer, ctx: McpToolContext) => {
  defineTool(server, ctx, {
    name: 'distribute_envelope',
    title: 'Send envelope',
    description:
      'Send a draft document to its recipients for signature. Emails are sent (unless the distribution method is NONE) and signing URLs are returned. Fails if a signer has no signature field.',
    inputSchema: ZDistributeEnvelopeRequestSchema.extend({ envelopeId: ZEnvelopeIdSchema }),
    outputSchema: ZDistributeEnvelopeResponseSchema,
    annotations: TOOL_ANNOTATIONS.send,
    identifiers: (input) => ({ envelopeId: input.envelopeId }),
    handler: async (input) => {
      const result = await ctx.caller.envelope.distribute(input);

      return {
        structured: result,
        text: `Sent ${result.id} to ${result.recipients.length} recipient(s)\n${summariseSigningUrls(result.recipients)}`,
      };
    },
  });

  defineTool(server, ctx, {
    name: 'resend_envelope',
    title: 'Resend / remind recipients',
    description:
      'Re-send the signing email to specific recipients who have not yet signed (a reminder). Also refreshes expired signing links. Pass the recipient IDs from get_envelope.',
    inputSchema: ZRedistributeEnvelopeRequestSchema.extend({ envelopeId: ZEnvelopeIdSchema }),
    outputSchema: ZRedistributeEnvelopeResponseSchema,
    annotations: TOOL_ANNOTATIONS.send,
    identifiers: (input) => ({ envelopeId: input.envelopeId }),
    handler: async (input) => {
      const result = await ctx.caller.envelope.redistribute(input);

      return {
        structured: result,
        text: `Reminded ${result.recipients.length} recipient(s) on ${result.id}\n${summariseSigningUrls(result.recipients)}`,
      };
    },
  });
};

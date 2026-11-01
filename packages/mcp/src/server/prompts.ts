import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { McpToolContext } from './context';

const userMessage = (text: string): GetPromptResult => ({
  messages: [
    {
      role: 'user',
      content: {
        type: 'text',
        text,
      },
    },
  ],
});

/**
 * Prompts encode the team's common signing workflows so clients can offer them
 * as slash commands. They only reference tools exposed by this server.
 */
export const registerPrompts = (server: McpServer, ctx: McpToolContext) => {
  server.registerPrompt(
    'send_contract_to_homeowner',
    {
      title: 'Send a contract to a homeowner',
      description:
        'Create a document from one of the team templates for a homeowner and send it for signature, then report the signing link.',
      argsSchema: {
        homeownerName: z.string().describe('Full name of the homeowner who will sign.'),
        homeownerEmail: z.string().describe('Email address of the homeowner.'),
        templateName: z
          .string()
          .optional()
          .describe('Name (or part of the name) of the template to use. Ask if several templates match.'),
        propertyAddress: z.string().optional().describe('Property address to mention in the email message.'),
      },
    },
    ({ homeownerName, homeownerEmail, templateName, propertyAddress }) =>
      userMessage(
        [
          `You are operating SR Sign for the team "${ctx.auth.team.name}".`,
          `Send a contract to ${homeownerName} <${homeownerEmail}> for signature.`,
          '',
          'Steps:',
          `1. Call list_templates${templateName ? ` with query "${templateName}"` : ''} and pick the matching template. If more than one template could match, list them and ask which one to use before continuing.`,
          '2. Call get_template to see the placeholder recipients. Map the signer placeholder to the homeowner (id, email, name). If the template has other placeholder recipients (for example a company representative), ask who should fill them unless it is obvious.',
          `3. Call create_document_from_template with distribute: true${propertyAddress ? ` and a short message that mentions the property at ${propertyAddress}` : ''}.`,
          '4. Reply with the new envelope ID and the signing URL for each recipient. Do not invent URLs; only report what the tool returned.',
          '',
          'If any tool returns an error, explain it plainly and stop rather than retrying with guessed values.',
        ].join('\n'),
      ),
  );

  server.registerPrompt(
    'check_signing_progress',
    {
      title: 'Check signing progress',
      description: 'Summarise who has signed, viewed or not yet opened a document, and what to do next.',
      argsSchema: {
        envelopeId: z.string().describe('The envelope ID of the document, or part of its title to search for.'),
      },
    },
    ({ envelopeId }) =>
      userMessage(
        [
          `Check the signing progress of "${envelopeId}".`,
          '',
          'If the value is not an envelope ID (envelope IDs start with "envelope_"), call list_envelopes with it as the query and type DOCUMENT, and ask which document is meant if several match.',
          'Call get_envelope and summarise: overall status, then one line per recipient with role, whether they have opened the document (readStatus) and whether they have signed (signingStatus), plus whether their signing link has expired.',
          'Finish with a recommendation: nothing to do if completed; otherwise offer to send a reminder with resend_envelope to the recipients who have not signed. Do not send the reminder unless asked.',
        ].join('\n'),
      ),
  );

  server.registerPrompt(
    'chase_unsigned_recipients',
    {
      title: 'Remind recipients who have not signed',
      description: 'Send a reminder to every recipient of a document who has not yet signed.',
      argsSchema: {
        envelopeId: z.string().describe('The envelope ID of the pending document.'),
      },
    },
    ({ envelopeId }) =>
      userMessage(
        [
          `Remind the recipients of envelope ${envelopeId} who have not signed yet.`,
          '',
          '1. Call get_envelope and collect the IDs of recipients whose signingStatus is NOT_SIGNED and whose role is SIGNER or APPROVER.',
          '2. Tell the user who will be reminded and wait for confirmation.',
          '3. After confirmation call resend_envelope with those recipient IDs and report the result.',
          'If the document is not PENDING, explain why reminders cannot be sent.',
        ].join('\n'),
      ),
  );
};

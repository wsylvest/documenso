import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { MCP_DOCUMENTATION_PATH, MCP_SERVER_NAME, MCP_SERVER_TITLE, MCP_SERVER_VERSION } from '../constants';
import type { McpToolContext } from './context';
import { registerPrompts } from './prompts';
import { registerResources } from './resources';
import { registerDistributionTools } from './tools/distribution';
import { registerEnvelopeFileTools } from './tools/envelope-files';
import { registerEnvelopeTools } from './tools/envelopes';
import { registerRecipientAndFieldTools } from './tools/recipients-fields';
import { registerSigningTools } from './tools/signing';
import { registerTeamAndFolderTools } from './tools/teams-folders';
import { registerTemplateTools } from './tools/templates';

const buildInstructions = (ctx: McpToolContext) =>
  [
    `Documenso document signing for team "${ctx.auth.team.name}" (${ctx.baseUrl}).`,
    'Documents and templates are both "envelopes" identified by an envelope ID (envelope_...).',
    'Typical flow: list_templates -> get_template -> create_document_from_template (distribute: true), or create_envelope -> add_recipients -> add_fields -> distribute_envelope.',
    'Check progress with get_envelope; remind with resend_envelope; fetch results with download_envelope_pdf, download_certificate and download_audit_log (returned as resource links).',
    'Tools starting with signing_ drive the recipient signing flow with a recipient signing token (native Signing API).',
    'Destructive tools require confirm: true and must only be called after the user explicitly confirmed.',
    `Documentation: ${ctx.baseUrl.replace(/\/+$/, '')}${MCP_DOCUMENTATION_PATH}`,
  ].join('\n');

/**
 * Build an MCP server bound to one authenticated context. In stateless mode a
 * server is created per HTTP request; in session mode one lives per session.
 *
 * Registration order is deterministic so `tools/list` is cacheable by clients.
 */
export const createDocumensoMcpServer = (ctx: McpToolContext) => {
  const server = new McpServer(
    {
      name: MCP_SERVER_NAME,
      title: MCP_SERVER_TITLE,
      version: MCP_SERVER_VERSION,
    },
    {
      instructions: buildInstructions(ctx),
    },
  );

  registerTeamAndFolderTools(server, ctx);
  registerTemplateTools(server, ctx);
  registerEnvelopeTools(server, ctx);
  registerEnvelopeFileTools(server, ctx);
  registerRecipientAndFieldTools(server, ctx);
  registerDistributionTools(server, ctx);
  registerSigningTools(server, ctx);

  registerResources(server, ctx);
  registerPrompts(server, ctx);

  return server;
};

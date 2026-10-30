import type { Logger } from 'pino';

import type { McpAuth } from './auth/authenticate';

/**
 * Non-sensitive identifiers a tool may attach to its log entry. Never include
 * signing tokens, API tokens or file contents.
 */
export type McpAuditIdentifiers = {
  envelopeId?: string;
  envelopeItemId?: string;
  recipientId?: number;
  fieldId?: number;
  templateId?: string;
  folderId?: string;
};

type LogMcpToolCallOptions = {
  logger: Logger;
  tool: string;
  auth: McpAuth;
  identifiers?: McpAuditIdentifiers;
  outcome: 'ok' | 'error';
  code?: string;
  durationMs: number;
  requestId?: string | number;
  sessionId?: string;
};

/**
 * Structured audit entry for every MCP tool call. The business audit trail
 * (`DOCUMENT_*` audit logs) is still written by the lib functions with the
 * API token's audit user; this adds the MCP-specific attribution.
 */
export const logMcpToolCall = ({
  logger,
  tool,
  auth,
  identifiers,
  outcome,
  code,
  durationMs,
  requestId,
  sessionId,
}: LogMcpToolCallOptions) => {
  const entry = {
    msg: 'mcp.tool',
    tool,
    userId: auth.user.id,
    teamId: auth.teamId,
    apiTokenId: auth.apiTokenId,
    outcome,
    code,
    durationMs,
    mcpRequestId: requestId,
    mcpSessionId: sessionId,
    ...identifiers,
  };

  if (outcome === 'error') {
    logger.warn(entry);

    return;
  }

  logger.info(entry);
};

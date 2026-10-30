import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { MCP_SESSION_IDLE_TTL_MS } from '../constants';

export type McpSession = {
  sessionId: string;
  apiTokenId: number;
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  lastSeenAt: number;
};

/**
 * Process-local registry for session mode. Sessions are bound to the API token
 * that initialised them so a leaked session id is useless without the token.
 */
const sessions = new Map<string, McpSession>();

let sweeper: NodeJS.Timeout | null = null;

const ensureSweeper = () => {
  if (sweeper) {
    return;
  }

  sweeper = setInterval(() => {
    const cutoff = Date.now() - MCP_SESSION_IDLE_TTL_MS;

    for (const session of sessions.values()) {
      if (session.lastSeenAt < cutoff) {
        void removeMcpSession(session.sessionId);
      }
    }
  }, 60_000);

  sweeper.unref();
};

export const registerMcpSession = (session: McpSession) => {
  sessions.set(session.sessionId, session);

  ensureSweeper();
};

export const getMcpSession = (sessionId: string, apiTokenId: number): McpSession | null => {
  const session = sessions.get(sessionId);

  if (!session || session.apiTokenId !== apiTokenId) {
    return null;
  }

  session.lastSeenAt = Date.now();

  return session;
};

export const removeMcpSession = async (sessionId: string) => {
  const session = sessions.get(sessionId);

  if (!session) {
    return;
  }

  sessions.delete(sessionId);

  await session.transport.close().catch(() => undefined);
  await session.server.close().catch(() => undefined);
};

export const getMcpSessionCount = () => sessions.size;

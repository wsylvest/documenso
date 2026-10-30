import { randomUUID } from 'node:crypto';
import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { getAgentProtocolSettings } from '@documenso/lib/server-only/site-settings/get-agent-protocol-settings';
import { env } from '@documenso/lib/utils/env';
import { logger as rootLogger } from '@documenso/lib/utils/logger';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Logger } from 'pino';

import { MCP_MAX_REQUEST_BODY_BYTES, MCP_PATH } from '../constants';
import { authenticateMcpRequest, type McpAuth, toAuthInfo } from './auth/authenticate';
import {
  buildProtectedResourceMetadata,
  buildWwwAuthenticateHeader,
  parseAuthorizationServers,
} from './auth/protected-resource-metadata';
import { createMcpToolContext } from './context';
import { createDocumensoMcpServer } from './mcp-server';
import { parseAllowedOrigins, validateMcpOrigin } from './origin';
import { getMcpSession, registerMcpSession, removeMcpSession } from './sessions';

/**
 * Minimal Hono environment: the remix router stores a request logger under
 * `logger`; everything else is optional so this sub-app can also be mounted in
 * tests without the full app context.
 */
export type McpHonoEnv = {
  Variables: {
    logger?: Logger;
  };
};

export const isMcpEnabled = () => env('NEXT_PUBLIC_MCP_ENABLED') === 'true';

const areSessionsEnabled = () => env('NEXT_PRIVATE_MCP_SESSIONS_ENABLED') === 'true';

const jsonRpcError = (c: Context<McpHonoEnv>, status: 400 | 404 | 405 | 500, code: number, message: string) =>
  c.json(
    {
      jsonrpc: '2.0',
      error: { code, message },
      id: null,
    },
    status,
  );

const unauthorised = (c: Context<McpHonoEnv>, baseUrl: string, error: 'invalid_token' | null, description: string) => {
  c.header(
    'WWW-Authenticate',
    buildWwwAuthenticateHeader({
      baseUrl,
      error: error ?? undefined,
      errorDescription: description,
    }),
  );

  return c.json(
    {
      error: error ?? 'unauthorized',
      error_description: description,
    },
    401,
  );
};

export const MCP_DISABLED_MESSAGE = 'The MCP server has been disabled by an administrator of this instance.';

/**
 * Site-setting kill switch. Unlike `isMcpEnabled` (deployment flag, 404) this
 * is flipped at runtime by a super-admin, so a 503 tells clients the server
 * exists but is currently unavailable. `error_description` repeats the message
 * for clients that only understand the RFC 6749 error shape.
 */
const serviceUnavailable = (c: Context<McpHonoEnv>) => {
  c.header('Cache-Control', 'no-store');

  return c.json(
    {
      error: 'MCP_DISABLED',
      message: MCP_DISABLED_MESSAGE,
      error_description: MCP_DISABLED_MESSAGE,
    },
    503,
  );
};

const forbidden = (c: Context<McpHonoEnv>, error: string, description: string) =>
  c.json(
    {
      error,
      error_description: description,
    },
    403,
  );

const createTransport = (sessionIdGenerator: (() => string) | undefined) =>
  new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator,
    enableJsonResponse: true,
    maxRequestBodySize: MCP_MAX_REQUEST_BODY_BYTES,
  });

/**
 * Stateless mode: a fresh server and transport per request, torn down once the
 * JSON response has been produced. Only POST carries JSON-RPC messages; there
 * is no standalone SSE stream without sessions.
 */
const handleStateless = async (c: Context<McpHonoEnv>, auth: McpAuth, logger: Logger) => {
  if (c.req.method !== 'POST') {
    c.header('Allow', 'POST');

    return jsonRpcError(c, 405, -32000, 'Method not allowed. This server runs stateless; send JSON-RPC via POST.');
  }

  const ctx = createMcpToolContext({ request: c.req.raw, auth, logger });

  const server = createDocumensoMcpServer(ctx);
  const transport = createTransport(undefined);

  await server.connect(transport);

  try {
    return await transport.handleRequest(c.req.raw, { authInfo: toAuthInfo(auth) });
  } finally {
    void transport.close().catch(() => undefined);
    void server.close().catch(() => undefined);
  }
};

/**
 * Session mode: `initialize` creates a server bound to the API token; later
 * requests must present the `Mcp-Session-Id` with the same token.
 */
const handleWithSessions = async (c: Context<McpHonoEnv>, auth: McpAuth, logger: Logger) => {
  const sessionId = c.req.header('mcp-session-id');

  if (sessionId) {
    const session = getMcpSession(sessionId, auth.apiTokenId);

    if (!session) {
      return jsonRpcError(c, 404, -32001, 'Session not found');
    }

    if (c.req.method === 'DELETE') {
      await removeMcpSession(sessionId);

      return c.body(null, 200);
    }

    return await session.transport.handleRequest(c.req.raw, { authInfo: toAuthInfo(auth) });
  }

  if (c.req.method !== 'POST') {
    return jsonRpcError(c, 400, -32000, 'Mcp-Session-Id header is required');
  }

  let parsedBody: unknown;

  try {
    parsedBody = await c.req.raw.clone().json();
  } catch {
    return jsonRpcError(c, 400, -32700, 'Parse error: request body must be JSON');
  }

  if (!isInitializeRequest(parsedBody)) {
    return jsonRpcError(c, 400, -32000, 'Bad request: no valid session ID provided');
  }

  const newSessionId = randomUUID();

  const ctx = createMcpToolContext({ request: c.req.raw, auth, logger, sessionId: newSessionId });

  const server = createDocumensoMcpServer(ctx);
  const transport = createTransport(() => newSessionId);

  transport.onclose = () => {
    void removeMcpSession(newSessionId);
  };

  registerMcpSession({
    sessionId: newSessionId,
    apiTokenId: auth.apiTokenId,
    transport,
    server,
    lastSeenAt: Date.now(),
  });

  await server.connect(transport);

  return await transport.handleRequest(c.req.raw, { authInfo: toAuthInfo(auth), parsedBody });
};

const handleMcpRequest = async (c: Context<McpHonoEnv>) => {
  const baseUrl = NEXT_PUBLIC_WEBAPP_URL();

  if (!isMcpEnabled()) {
    return c.json({ error: 'mcp_disabled', error_description: 'The MCP server is not enabled on this instance.' }, 404);
  }

  const { mcpEnabled } = await getAgentProtocolSettings();

  if (!mcpEnabled) {
    return serviceUnavailable(c);
  }

  const isOriginValid = validateMcpOrigin({
    origin: c.req.header('origin'),
    baseUrl,
    allowedOrigins: parseAllowedOrigins(env('NEXT_PRIVATE_MCP_ALLOWED_ORIGINS')),
  });

  if (!isOriginValid) {
    return forbidden(c, 'invalid_origin', 'Origin is not allowed.');
  }

  const authResult = await authenticateMcpRequest(c.req.raw);

  if (!authResult.ok) {
    if (authResult.status === 403) {
      return forbidden(c, authResult.error, authResult.description);
    }

    return unauthorised(c, baseUrl, authResult.error, authResult.description);
  }

  const logger = (c.get('logger') ?? rootLogger).child({ mcpPath: MCP_PATH });

  try {
    if (areSessionsEnabled()) {
      return await handleWithSessions(c, authResult.auth, logger);
    }

    return await handleStateless(c, authResult.auth, logger);
  } catch (error) {
    logger.error({ msg: 'mcp.request.failed', err: error });

    return jsonRpcError(c, 500, -32603, 'Internal error');
  }
};

/**
 * Streamable HTTP endpoint. Mount at `/api/mcp`.
 */
export const mcpRoute = new Hono<McpHonoEnv>()
  .use(
    '*',
    cors({
      origin: (origin) => origin,
      allowHeaders: [
        'Authorization',
        'Content-Type',
        'Accept',
        'Mcp-Session-Id',
        'MCP-Protocol-Version',
        'Last-Event-ID',
      ],
      exposeHeaders: ['Mcp-Session-Id', 'MCP-Protocol-Version', 'WWW-Authenticate'],
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    }),
  )
  .all('/', handleMcpRequest);

const handleProtectedResourceMetadata = async (c: Context<McpHonoEnv>) => {
  if (!isMcpEnabled()) {
    return c.json({ error: 'mcp_disabled' }, 404);
  }

  const { mcpEnabled } = await getAgentProtocolSettings();

  if (!mcpEnabled) {
    return serviceUnavailable(c);
  }

  c.header('Cache-Control', 'public, max-age=3600');

  return c.json(
    buildProtectedResourceMetadata({
      baseUrl: NEXT_PUBLIC_WEBAPP_URL(),
      authorizationServers: parseAuthorizationServers(env('NEXT_PRIVATE_MCP_AUTHORIZATION_SERVERS')),
    }),
  );
};

/**
 * RFC 9728 protected resource metadata. Mount at
 * `/.well-known/oauth-protected-resource`; serves both the bare document and
 * the `/api/mcp` path-suffix form.
 */
export const mcpWellKnownRoute = new Hono<McpHonoEnv>()
  .use('*', cors())
  .get('/', handleProtectedResourceMetadata)
  .get(MCP_PATH, handleProtectedResourceMetadata);

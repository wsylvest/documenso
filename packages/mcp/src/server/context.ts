import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { extractRequestMetadata, type RequestMetadata } from '@documenso/lib/universal/extract-request-metadata';
import { logger as rootLogger } from '@documenso/lib/utils/logger';
import type { TrpcContext } from '@documenso/trpc/server/context';
import { appRouter } from '@documenso/trpc/server/router';
import { createCallerFactory } from '@documenso/trpc/server/trpc';
import type { Logger } from 'pino';

import type { McpAuth } from './auth/authenticate';

const createCaller = createCallerFactory(appRouter);

export type McpCaller = ReturnType<typeof createCaller>;

/**
 * Everything a tool, resource or prompt handler needs. One context is created
 * per authenticated HTTP request (stateless mode) or per session.
 */
export type McpToolContext = {
  auth: McpAuth;

  /**
   * Server-side caller for the tRPC `appRouter`. Its context carries the
   * original request, so `authenticatedMiddleware` resolves the API token and
   * applies the same permission checks and audit attribution as API V2.
   */
  caller: McpCaller;

  logger: Logger;
  requestMetadata: RequestMetadata;

  /**
   * Public web app URL, used to build download URLs and documentation links.
   */
  baseUrl: string;

  sessionId?: string;
};

type CreateMcpToolContextOptions = {
  request: Request;
  auth: McpAuth;
  logger?: Logger;
  sessionId?: string;
};

export const createMcpToolContext = ({
  request,
  auth,
  logger,
  sessionId,
}: CreateMcpToolContextOptions): McpToolContext => {
  const requestMetadata = extractRequestMetadata(request);

  const mcpLogger = (logger ?? rootLogger).child({
    mcp: true,
    userId: auth.user.id,
    teamId: auth.teamId,
    apiTokenId: auth.apiTokenId,
    mcpSessionId: sessionId,
  });

  // Mirrors `createTrpcContext` for an API V2 request without a session. The
  // authenticated middleware reads the Authorization header from `req` and
  // overrides `teamId` with the token's team.
  const trpcContext: TrpcContext = {
    logger: mcpLogger,
    session: null,
    user: null,
    teamId: auth.teamId,
    req: request,
    res: new Response(),
    metadata: {
      requestMetadata,
      source: 'apiV2',
      auth: null,
    },
  };

  return {
    auth,
    caller: createCaller(trpcContext),
    logger: mcpLogger,
    requestMetadata,
    baseUrl: NEXT_PUBLIC_WEBAPP_URL(),
    sessionId,
  };
};

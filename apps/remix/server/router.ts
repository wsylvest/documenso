import { acp, agentCardHandler, isAcpEnabled, markOrphanedAcpRuns } from '@documenso/acp';
import { tsRestHonoApp } from '@documenso/api/hono';
import { auth } from '@documenso/auth/server';
import { csc } from '@documenso/ee/server-only/signing/csc/hono';
import { jobsClient } from '@documenso/lib/jobs/client';
import { LicenseClient } from '@documenso/lib/server-only/license/license-client';
import { createRateLimitMiddleware } from '@documenso/lib/server-only/rate-limit/rate-limit-middleware';
import {
  aiRateLimit,
  apiAcpRateLimit,
  apiTrpcRateLimit,
  apiV1RateLimit,
  apiV2RateLimit,
  fileUploadRateLimit,
  mcpRateLimit,
} from '@documenso/lib/server-only/rate-limit/rate-limits';
import { TelemetryClient } from '@documenso/lib/server-only/telemetry/telemetry-client';
import { migrateDeletedAccountServiceAccount } from '@documenso/lib/server-only/user/service-accounts/deleted-account';
import { migrateLegacyServiceAccount } from '@documenso/lib/server-only/user/service-accounts/legacy-service-account';
import { env } from '@documenso/lib/utils/env';
import { logger } from '@documenso/lib/utils/logger';
import { MCP_PATH, MCP_PROTECTED_RESOURCE_METADATA_PATH, mcpRoute, mcpWellKnownRoute } from '@documenso/mcp';
import { openApiDocument } from '@documenso/trpc/server/open-api';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { cors } from 'hono/cors';
import type { RequestIdVariables } from 'hono/request-id';
import { requestId } from 'hono/request-id';
import type { Logger } from 'pino';

import { aiRoute } from './api/ai/route';
import { downloadRoute } from './api/download/download';
import { filesRoute } from './api/files/files';
import { type AppContext, appContext } from './context';
import { appMiddleware } from './middleware';
import { securityHeadersMiddleware } from './security-headers';
import { openApiTrpcServerHandler } from './trpc/hono-trpc-open-api';
import { reactRouterTrpcServer } from './trpc/hono-trpc-remix';

// Re-export so the rollup build (entry: server/router.ts) bundles
// load-context.ts. server/main.js imports getLoadContext from the rolled-up
// output to wire it into the React Router adapter.
export { getLoadContext } from './load-context';

export interface HonoEnv {
  Variables: RequestIdVariables & {
    context: AppContext;
    logger: Logger;
    cspNonce: string;
  };
}

const basePath = (env('NEXT_PUBLIC_BASE_PATH') ?? '').replace(/\/$/, '');

const app = new Hono<HonoEnv>().basePath(basePath || '/');

/**
 * Database-backed rate limiting for API routes.
 */
const apiV1RateLimitMiddleware = createRateLimitMiddleware(apiV1RateLimit);
const apiV2RateLimitMiddleware = createRateLimitMiddleware(apiV2RateLimit);
const aiRateLimitMiddleware = createRateLimitMiddleware(aiRateLimit);
const trpcRateLimitMiddleware = createRateLimitMiddleware(apiTrpcRateLimit);
const fileRateLimitMiddleware = createRateLimitMiddleware(fileUploadRateLimit);
const mcpRateLimitMiddleware = createRateLimitMiddleware(mcpRateLimit);
const acpRateLimitMiddleware = createRateLimitMiddleware(apiAcpRateLimit);

/**
 * Attach session and context to requests.
 */
app.use(contextStorage());
app.use(appContext);

/**
 * Emit response security headers (CSP with per-request nonce, plus
 * Referrer-Policy and X-Content-Type-Options on embed routes). Must run
 * after `contextStorage()` so the nonce is readable via `getContext()` from
 * `getLoadContext`, and before the React Router handler so the response
 * carries the header.
 */
app.use(securityHeadersMiddleware);

/**
 * RR7 app middleware.
 */
app.use('*', appMiddleware);
app.use('*', requestId());
app.use(async (c, next) => {
  const metadata = c.get('context').requestMetadata;

  const honoLogger = logger.child({
    requestId: c.var.requestId,
    requestPath: c.req.path,
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
  });

  c.set('logger', honoLogger);

  await next();
});

// Apply cors and rate limits to API routes.
app.use(`/api/v1/*`, cors());
app.use('/api/v1/*', apiV1RateLimitMiddleware);
app.use(`/api/v2/*`, cors());
app.use('/api/v2/*', apiV2RateLimitMiddleware);
app.use(`/api/v2-beta/*`, cors());
app.use('/api/v2-beta/*', apiV2RateLimitMiddleware);

// Auth server.
app.route('/api/auth', auth);

// Files route.
app.use('/api/files/upload-pdf', fileRateLimitMiddleware);
app.route('/api/files', filesRoute);

// AI route.
app.use('/api/ai/*', aiRateLimitMiddleware);
app.route('/api/ai', aiRoute);

// CSC OAuth routes (mounted from @documenso/ee).
app.route('/api/csc', csc);

// MCP (Model Context Protocol) server: Streamable HTTP transport plus the
// RFC 9728 protected resource metadata used for OAuth discovery. Both answer
// 404 unless NEXT_PUBLIC_MCP_ENABLED=true.
app.use(MCP_PATH, mcpRateLimitMiddleware);
app.route(MCP_PATH, mcpRoute);
app.route(MCP_PROTECTED_RESOURCE_METADATA_PATH, mcpWellKnownRoute);

// API servers.
app.route('/api/v1', tsRestHonoApp);
app.use('/api/jobs/*', jobsClient.getApiHandler());

app.use('/api/trpc/*', trpcRateLimitMiddleware);
app.use('/api/trpc/*', reactRouterTrpcServer);

// Unstable API server routes. Order matters for these two.
app.get(`/api/v2/openapi.json`, (c) => c.json(openApiDocument));
// Shadows the download routes that tRPC defines since tRPC-to-openapi doesn't support their return types.
app.route(`/api/v2`, downloadRoute);
app.use(`/api/v2/*`, async (c) =>
  openApiTrpcServerHandler(c, {
    isBeta: false,
  }),
);

// Agent Communication Protocol server (@documenso/acp). Feature flagged via
// NEXT_PUBLIC_ACP_ENABLED. The A2A Agent Card is also served from the domain
// root well-known location as the A2A specification requires.
if (isAcpEnabled()) {
  app.use('/api/acp/*', cors());
  app.use('/api/acp/*', acpRateLimitMiddleware);
  app.route('/api/acp', acp);

  app.get('/.well-known/agent-card.json', agentCardHandler);
  app.get('/.well-known/agent.json', agentCardHandler);

  // Runs execute in-process, so anything still running from a previous
  // process can never finish. Mark them failed so clients stop waiting.
  void markOrphanedAcpRuns().catch((err) => {
    logger.error({ msg: 'Failed to mark orphaned ACP runs', err });
  });
}

// Unstable API server routes. Order matters for these two.
app.get(`/api/v2-beta/openapi.json`, (c) => c.json(openApiDocument));
// Shadows the download routes that tRPC defines since tRPC-to-openapi doesn't support their return types.
app.route(`/api/v2-beta`, downloadRoute);
app.use(`/api/v2-beta/*`, async (c) =>
  openApiTrpcServerHandler(c, {
    isBeta: true,
  }),
);

// Start telemetry client for anonymous usage tracking.
// Can be disabled by setting DOCUMENSO_DISABLE_TELEMETRY=true
if (env('NODE_ENV') !== 'development') {
  void TelemetryClient.start();
}

// Start license client to verify license on startup.
void LicenseClient.start();

// Start cron scheduler for background jobs (e.g. envelope expiration sweep).
// No-op for Inngest provider which handles cron externally.
jobsClient.startCron();

void migrateDeletedAccountServiceAccount();
void migrateLegacyServiceAccount();

export default app;

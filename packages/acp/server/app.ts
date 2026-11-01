import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { AppError } from '@documenso/lib/errors/app-error';
import { getAgentProtocolSettings } from '@documenso/lib/server-only/site-settings/get-agent-protocol-settings';
import type { RequestMetadata } from '@documenso/lib/universal/extract-request-metadata';
import { env } from '@documenso/lib/utils/env';
import { logger as rootLogger } from '@documenso/lib/utils/logger';
import { SIGNER_IP_ADDRESS_HEADER, SIGNER_USER_AGENT_HEADER } from '@documenso/trpc/server/signing-router/schema';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import type { Logger } from 'pino';

import { getAgentOrThrow, listAgents, toAgentManifest } from '../agents/registry';
import type { AcpPrincipal } from '../agents/types';
import { buildAgentCard } from '../protocol/a2a';
import { type TRunMode, ZListQuerySchema, ZRunCreateRequestSchema, ZRunResumeRequestSchema } from '../protocol/schemas';
import { awaitRunForSync, cancelRun, getSession, resumeRun, type StartedRun, startRun } from '../runs/run-service';
import { countRunEvents, getRunOrThrow, listRunEvents, toAcpRun } from '../runs/run-store';
import { resolveAcpPrincipal } from './auth';
import { ACP_PROTOCOL_VERSION } from './config';
import { toAcpError } from './errors';
import { streamRunEvents } from './sse';

/**
 * The variables the host app (apps/remix/server/router.ts) sets before this
 * sub-app runs. Kept local so the package does not depend on the Remix server.
 */
export type AcpHonoEnv = {
  Variables: {
    logger?: Logger;
    context?: {
      requestMetadata: RequestMetadata;
    };
    acpPrincipal: AcpPrincipal;
  };
};

type AcpContext = Context<AcpHonoEnv>;

const getLogger = (c: AcpContext): Logger => c.get('logger') ?? rootLogger;

const getRequestMetadata = (c: AcpContext): RequestMetadata => c.get('context')?.requestMetadata ?? {};

export const ACP_DISABLED_MESSAGE = 'The ACP server has been disabled by an administrator of this instance.';

/**
 * 503 body returned while the site-setting switch is off. `error` and
 * `message` are the documented kill-switch shape; `code` and `data.code` keep
 * the body a valid ACP `Error` so conformant clients can still parse it.
 */
export const buildAcpDisabledBody = () => ({
  error: 'ACP_DISABLED' as const,
  message: ACP_DISABLED_MESSAGE,
  code: 'server_error' as const,
  data: { code: 'ACP_DISABLED' as const },
});

const serviceUnavailable = (c: Context) => {
  c.header('Cache-Control', 'no-store');

  return c.json(buildAcpDisabledBody(), 503);
};

/**
 * Site-setting kill switch, checked per request (cached for 30 seconds in
 * `getAgentProtocolSettings`). Applies to discovery as well as runs so a
 * disabled server advertises nothing.
 */
const acpSiteSettingGate: MiddlewareHandler<AcpHonoEnv> = async (c, next) => {
  const { acpEnabled } = await getAgentProtocolSettings();

  if (!acpEnabled) {
    return serviceUnavailable(c);
  }

  await next();
};

/**
 * Authenticate with an API token and attach the principal to the context.
 */
const acpAuthMiddleware: MiddlewareHandler<AcpHonoEnv> = async (c, next) => {
  const principal = await resolveAcpPrincipal({
    authorizationHeader: c.req.header('authorization'),
    requestMetadata: getRequestMetadata(c),
  });

  // Signer details forwarded by integrations that proxy a human signer, as
  // in the native Signing API. Validated when a signing agent uses them.
  const forwardedIpAddress = c.req.header(SIGNER_IP_ADDRESS_HEADER);
  const forwardedUserAgent = c.req.header(SIGNER_USER_AGENT_HEADER);

  if (forwardedIpAddress !== undefined || forwardedUserAgent !== undefined) {
    principal.forwardedSigner = { ipAddress: forwardedIpAddress, userAgent: forwardedUserAgent };
  }

  c.set('acpPrincipal', principal);

  getLogger(c).info({
    auth: 'api',
    source: 'apiV2',
    path: c.req.path,
    userId: principal.user.id,
    apiTokenId: principal.apiTokenId,
    acpTeamId: principal.teamId,
  });

  await next();
};

const requestLogger = (c: AcpContext, principal: AcpPrincipal): Logger =>
  getLogger(c).child({
    auth: 'api',
    source: 'apiV2',
    path: c.req.path,
    userId: principal.user.id,
    apiTokenId: principal.apiTokenId,
  });

const agentCardHandler = async (c: Context) => {
  const { acpEnabled } = await getAgentProtocolSettings();

  if (!acpEnabled) {
    return serviceUnavailable(c);
  }

  return c.json(
    buildAgentCard({
      webAppUrl: NEXT_PUBLIC_WEBAPP_URL(),
      version: env('APP_VERSION') ?? '0.0.0',
    }),
  );
};

/**
 * Respond to a create or resume request according to the requested mode.
 */
const respondForMode = async (c: AcpContext, started: StartedRun, mode: TRunMode, afterSequence: number) => {
  const { teamId } = c.get('acpPrincipal');

  c.header('X-Run-Id', started.run.id);

  if (started.replayed) {
    c.header('Idempotent-Replayed', 'true');
  }

  if (mode === 'stream' && !started.replayed) {
    return streamRunEvents(c, { runId: started.run.id, teamId, afterSequence });
  }

  if (mode === 'async' && !started.replayed) {
    return c.json(toAcpRun(started.run), 202);
  }

  return c.json(await awaitRunForSync(started, teamId), 200);
};

export const acp = new Hono<AcpHonoEnv>()
  .onError((error, c) => {
    const { status, body } = toAcpError(error);

    if (status >= 500) {
      getLogger(c).error({ msg: 'ACP request failed', err: error });
    } else if (!(error instanceof AppError)) {
      getLogger(c).warn({ msg: 'ACP request rejected', err: error });
    }

    // Hono's typed status union does not cover every value in our mapping.
    // biome-ignore lint/suspicious/noExplicitAny: status is validated by toAcpError.
    return c.json(body, status as any);
  })

  .use('*', acpSiteSettingGate)

  // ---- Discovery (unauthenticated, static) ----

  .get('/ping', (c) => c.json({}))

  .get('/', (c) =>
    c.json({
      name: 'SR Sign ACP server',
      protocol: ACP_PROTOCOL_VERSION,
      agents: `${c.req.url.replace(/\/$/, '')}/agents`,
      agent_card: `${c.req.url.replace(/\/$/, '')}/.well-known/agent-card.json`,
      documentation: 'https://github.com/wsylvest/documenso/blob/main/apps/docs/content/docs/developers/acp.mdx',
    }),
  )

  .get('/agents', (c) => {
    const { limit, offset } = ZListQuerySchema.parse(c.req.query());

    const agents = listAgents()
      .slice(offset, offset + limit)
      .map(toAgentManifest);

    return c.json({ agents });
  })

  .get('/agents/:name', (c) => {
    const agent = getAgentOrThrow(c.req.param('name'));

    return c.json(toAgentManifest(agent));
  })

  .get('/.well-known/agent-card.json', agentCardHandler)
  .get('/.well-known/agent.json', agentCardHandler)

  // ---- Runs (authenticated) ----

  .use('/runs', acpAuthMiddleware)
  .use('/runs/*', acpAuthMiddleware)
  .use('/sessions/*', acpAuthMiddleware)
  .use('/session/*', acpAuthMiddleware)
  .use('/a2a', acpAuthMiddleware)

  .post('/runs', async (c) => {
    const principal = c.get('acpPrincipal');
    const body = ZRunCreateRequestSchema.parse(await c.req.json());

    if (body.session_id && body.session && body.session_id !== body.session.id) {
      throw new AppError('INVALID_REQUEST', {
        message: 'session_id does not match session.id',
        statusCode: 400,
      });
    }

    const idempotencyKey = c.req.header('idempotency-key') ?? body.idempotency_key ?? null;

    const started = await startRun({
      principal,
      logger: requestLogger(c, principal),
      agentName: body.agent_name,
      input: body.input,
      sessionId: body.session_id ?? body.session?.id ?? null,
      idempotencyKey,
    });

    return await respondForMode(c, started, body.mode, 0);
  })

  .get('/runs/:runId', async (c) => {
    const { teamId } = c.get('acpPrincipal');
    const run = await getRunOrThrow({ runId: c.req.param('runId'), teamId });

    return c.json(toAcpRun(run));
  })

  .post('/runs/:runId', async (c) => {
    const principal = c.get('acpPrincipal');
    const runId = c.req.param('runId');
    const body = ZRunResumeRequestSchema.parse(await c.req.json());

    if (body.run_id && body.run_id !== runId) {
      throw new AppError('INVALID_REQUEST', {
        message: 'run_id in the body does not match the path',
        statusCode: 400,
      });
    }

    const afterSequence = await countRunEvents({ runId, teamId: principal.teamId });

    const started = await resumeRun({
      principal,
      logger: requestLogger(c, principal),
      runId,
      awaitResume: body.await_resume,
    });

    return await respondForMode(c, started, body.mode, afterSequence);
  })

  .post('/runs/:runId/cancel', async (c) => {
    const principal = c.get('acpPrincipal');

    const run = await cancelRun({
      principal,
      logger: requestLogger(c, principal),
      runId: c.req.param('runId'),
    });

    return c.json(toAcpRun(run), 202);
  })

  .get('/runs/:runId/events', async (c) => {
    const { teamId } = c.get('acpPrincipal');
    const runId = c.req.param('runId');

    // 404 for unknown or foreign runs rather than an empty list.
    await getRunOrThrow({ runId, teamId });

    const events = await listRunEvents({ runId, teamId });

    return c.json({ events: events.map(({ sequence: _sequence, ...event }) => event) });
  })

  .get('/sessions/:sessionId', async (c) => {
    const { teamId } = c.get('acpPrincipal');

    return c.json(await getSession({ sessionId: c.req.param('sessionId'), teamId }));
  })

  // The OpenAPI document spells the path in the singular.
  .get('/session/:sessionId', async (c) => {
    const { teamId } = c.get('acpPrincipal');

    return c.json(await getSession({ sessionId: c.req.param('sessionId'), teamId }));
  })

  // ---- A2A JSON-RPC binding (authenticated) ----

  .post('/a2a', async (c) => {
    const principal = c.get('acpPrincipal');

    const { handleA2aJsonRpc } = await import('./a2a-handler');

    let body: unknown;

    try {
      body = await c.req.json();
    } catch {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }

    const response = await handleA2aJsonRpc(body, { principal, logger: requestLogger(c, principal) });

    return c.json(response);
  });

export { agentCardHandler };

import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { getOrganisationClaimByTeamId } from '@documenso/lib/server-only/organisation/get-organisation-claims';
import { getApiTokenByToken } from '@documenso/lib/server-only/public-api/get-api-token-by-token';
import { assertUserNotDisabled } from '@documenso/lib/server-only/user/assert-user-not-disabled';
import { isClaimFlagEnabled } from '@documenso/lib/utils/claim-flags';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

import { parseBearerToken } from './parse-bearer-token';

/**
 * The identity every MCP request runs under. Mirrors what the API V2
 * `authenticatedMiddleware` derives from an API token.
 */
export type McpAuth = {
  apiTokenId: number;
  user: {
    id: number;
    email: string;
    name: string | null;
  };
  teamId: number;
  team: {
    id: number;
    name: string;
    url: string;
    organisationId: string;
  };
};

/**
 * Structural subset of the `getApiTokenByToken` result so the mapping can be
 * unit tested without Prisma.
 */
export type ApiTokenLike = {
  id: number;
  teamId: number;
  user: {
    id: number;
    email: string;
    name: string | null;
  };
  team: {
    id: number;
    name: string;
    url: string;
    organisationId: string;
  } | null;
};

export const mapApiTokenToMcpAuth = (apiToken: ApiTokenLike): McpAuth => {
  if (!apiToken.team) {
    throw new AppError(AppErrorCode.UNAUTHORIZED, {
      message: 'API token is not scoped to a team',
      statusCode: 401,
    });
  }

  return {
    apiTokenId: apiToken.id,
    user: {
      id: apiToken.user.id,
      email: apiToken.user.email,
      name: apiToken.user.name,
    },
    teamId: apiToken.teamId,
    team: {
      id: apiToken.team.id,
      name: apiToken.team.name,
      url: apiToken.team.url,
      organisationId: apiToken.team.organisationId,
    },
  };
};

/**
 * The SDK `AuthInfo` handed to the transport. The raw API token is deliberately
 * not stored on it; the opaque token id is enough to correlate logs.
 */
export const toAuthInfo = (auth: McpAuth): AuthInfo => ({
  token: `api-token:${auth.apiTokenId}`,
  clientId: `api-token:${auth.apiTokenId}`,
  scopes: [`team:${auth.teamId}`],
  extra: {
    authMethod: 'api_token',
    apiTokenId: auth.apiTokenId,
    userId: auth.user.id,
    teamId: auth.teamId,
  },
});

export const MCP_ACCESS_DENIED_ERROR = 'mcp_access_denied';

export const MCP_ACCESS_DENIED_DESCRIPTION =
  'MCP server access is not enabled for this organisation. Ask an instance administrator to grant the "MCP server access" flag.';

export type McpAuthenticateResult =
  | {
      ok: true;
      auth: McpAuth;
    }
  | {
      ok: false;
      status: 401;

      /**
       * RFC 6750 error code. `null` when no credentials were presented.
       */
      error: 'invalid_token' | null;
      description: string;
    }
  | {
      ok: false;
      status: 403;

      /**
       * The token is valid but the organisation has not been granted MCP access.
       */
      error: typeof MCP_ACCESS_DENIED_ERROR;
      description: string;
    };

/**
 * Whether the organisation that owns the team may use the MCP server. The
 * `mcpAccess` claim flag is explicit-only, so it must be granted by a
 * super-admin even on instances without billing.
 */
export const hasMcpAccess = async (teamId: number): Promise<boolean> => {
  const organisationClaim = await getOrganisationClaimByTeamId({ teamId });

  return isClaimFlagEnabled(organisationClaim.flags, 'mcpAccess');
};

/**
 * Authenticate an MCP HTTP request.
 *
 * Only Documenso API tokens are accepted. This is the single place to extend
 * when OAuth 2.1 access tokens issued by an external authorization server are
 * supported: validate the JWT against the issuer's JWKS, check the audience is
 * the MCP resource URL, map the subject to a user and team and return the same
 * `McpAuth` shape so every tool keeps working unchanged.
 */
export const authenticateMcpRequest = async (request: Request): Promise<McpAuthenticateResult> => {
  const token = parseBearerToken(request.headers.get('authorization'));

  if (!token) {
    return {
      ok: false,
      status: 401,
      error: null,
      description: 'An API token is required. Send it as Authorization: Bearer api_...',
    };
  }

  let auth: McpAuth;

  try {
    // The organisation API quota is counted per tool call by the tRPC
    // middleware, so the transport-level check must not count again.
    const apiToken = await getApiTokenByToken({ token, bypassRateLimit: true });

    assertUserNotDisabled(apiToken.user);

    auth = mapApiTokenToMcpAuth(apiToken);
  } catch (error) {
    const appError = AppError.parseError(error);

    return {
      ok: false,
      status: 401,
      error: 'invalid_token',
      description: appError.message || 'Invalid API token',
    };
  }

  if (!(await hasMcpAccess(auth.teamId))) {
    return {
      ok: false,
      status: 403,
      error: MCP_ACCESS_DENIED_ERROR,
      description: MCP_ACCESS_DENIED_DESCRIPTION,
    };
  }

  return {
    ok: true,
    auth,
  };
};

import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { getApiTokenByToken } from '@documenso/lib/server-only/public-api/get-api-token-by-token';
import { assertUserNotDisabled } from '@documenso/lib/server-only/user/assert-user-not-disabled';
import type { ApiRequestMetadata, RequestMetadata } from '@documenso/lib/universal/extract-request-metadata';

import type { AcpPrincipal } from '../agents/types';

/**
 * Extract the raw token from an Authorization header.
 *
 * Supports both "Authorization: Bearer api_xxx" and "Authorization: api_xxx",
 * matching `authenticatedMiddleware` in `@documenso/trpc/server/trpc.ts`.
 */
export const parseAuthorizationHeader = (header: string | null | undefined): string | null => {
  const [token] = (header || '').split('Bearer ').filter((s) => s.length > 0);

  if (!token) {
    return null;
  }

  return token.trim() || null;
};

type ApiTokenIdentity = {
  user: {
    id: number;
    name: string | null;
    email: string;
  };
  team: {
    name: string;
  } | null;
};

/**
 * Build the request metadata that lib functions use for audit log attribution.
 * Identical to what API V2 passes: team tokens are attributed to the team,
 * personal tokens to the user.
 */
export const buildApiRequestMetadata = (
  apiToken: ApiTokenIdentity,
  requestMetadata: RequestMetadata,
): ApiRequestMetadata => {
  return {
    requestMetadata,
    source: 'apiV2',
    auth: 'api',
    auditUser: apiToken.team
      ? {
          id: null,
          email: null,
          name: apiToken.team.name,
        }
      : {
          id: apiToken.user.id,
          email: apiToken.user.email,
          name: apiToken.user.name,
        },
  };
};

type ResolveAcpPrincipalOptions = {
  authorizationHeader: string | null | undefined;
  requestMetadata: RequestMetadata;
};

/**
 * Authenticate an ACP request with an API token and produce the principal
 * every run is attributed to.
 */
export const resolveAcpPrincipal = async ({
  authorizationHeader,
  requestMetadata,
}: ResolveAcpPrincipalOptions): Promise<AcpPrincipal> => {
  const token = parseAuthorizationHeader(authorizationHeader);

  if (!token) {
    throw new AppError(AppErrorCode.UNAUTHORIZED, {
      message: 'API token was not provided',
      statusCode: 401,
    });
  }

  const apiToken = await getApiTokenByToken({ token });

  assertUserNotDisabled(apiToken.user);

  return {
    user: {
      id: apiToken.user.id,
      name: apiToken.user.name,
      email: apiToken.user.email,
    },
    teamId: apiToken.teamId,
    apiTokenId: apiToken.id,
    metadata: buildApiRequestMetadata(apiToken, requestMetadata),
  };
};

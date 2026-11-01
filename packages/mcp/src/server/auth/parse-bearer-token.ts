/**
 * Extract the credential from an `Authorization` header.
 *
 * Accepts both `Bearer api_xxx` and a bare `api_xxx`, matching the behaviour of
 * the API V2 `authenticatedMiddleware`. Returns `null` when nothing usable is
 * present.
 */
export const parseBearerToken = (header: string | null | undefined): string | null => {
  if (!header) {
    return null;
  }

  const trimmed = header.trim();

  if (!trimmed) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(trimmed);

  const token = (match ? match[1] : trimmed).trim();

  // A scheme without a credential (`Bearer`) is not a token.
  if (!token || /^Bearer$/i.test(token)) {
    return null;
  }

  return token;
};

/**
 * Whether a credential looks like an SR Sign API token.
 */
export const isApiToken = (token: string) => token.startsWith('api_');

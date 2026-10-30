const toOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

/**
 * Parse a comma separated list of origins. Entries are normalised to
 * `scheme://host[:port]`; invalid entries are dropped.
 */
export const parseAllowedOrigins = (value: string | undefined | null): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(toOrigin)
    .filter((origin): origin is string => origin !== null);
};

type ValidateMcpOriginOptions = {
  /**
   * The `Origin` request header, if any.
   */
  origin: string | null | undefined;

  /**
   * Public URL of the web app. Its origin is always allowed.
   */
  baseUrl: string;

  /**
   * Extra allowed origins.
   */
  allowedOrigins?: string[];
};

/**
 * DNS rebinding protection required by the MCP Streamable HTTP transport.
 *
 * Browser clients send an `Origin` header which must match the web app or an
 * explicitly allowed origin. Non-browser clients (desktop apps, servers) do not
 * send one and are accepted; they authenticate with a bearer token anyway.
 */
export const validateMcpOrigin = ({ origin, baseUrl, allowedOrigins = [] }: ValidateMcpOriginOptions): boolean => {
  if (origin === null || origin === undefined || origin === '') {
    return true;
  }

  const requestOrigin = toOrigin(origin);

  if (!requestOrigin) {
    return false;
  }

  const baseOrigin = toOrigin(baseUrl);

  if (baseOrigin && requestOrigin === baseOrigin) {
    return true;
  }

  return allowedOrigins.includes(requestOrigin);
};

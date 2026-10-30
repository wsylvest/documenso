import { MCP_DOCUMENTATION_PATH, MCP_PATH, MCP_PROTECTED_RESOURCE_METADATA_PATH } from '../../constants';

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) as required by the MCP
 * authorization specification (2025-06-18 and later).
 */
export type ProtectedResourceMetadata = {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  scopes_supported: string[];
  resource_name: string;
  resource_documentation?: string;
};

type BuildProtectedResourceMetadataOptions = {
  /**
   * Public base URL of the web app, e.g. `https://sign.smartroofing.ai`.
   */
  baseUrl: string;

  /**
   * Issuer URLs of authorization servers that can mint tokens for this resource.
   * Empty when only Documenso API tokens are accepted.
   */
  authorizationServers?: string[];
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

/**
 * The canonical resource identifier (RFC 8707) of the MCP server.
 */
export const getMcpResourceUrl = (baseUrl: string) => `${trimTrailingSlash(baseUrl)}${MCP_PATH}`;

/**
 * URL of the protected resource metadata document, using the RFC 9728 path
 * suffix form so several resources on one host can publish distinct documents.
 */
export const getProtectedResourceMetadataUrl = (baseUrl: string) =>
  `${trimTrailingSlash(baseUrl)}${MCP_PROTECTED_RESOURCE_METADATA_PATH}${MCP_PATH}`;

/**
 * Parse a comma separated list of issuer URLs. Invalid entries are dropped.
 */
export const parseAuthorizationServers = (value: string | undefined | null): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .filter((entry) => {
      try {
        const url = new URL(entry);

        return url.protocol === 'https:' || url.protocol === 'http:';
      } catch {
        return false;
      }
    })
    .map((entry) => trimTrailingSlash(entry));
};

export const buildProtectedResourceMetadata = ({
  baseUrl,
  authorizationServers = [],
}: BuildProtectedResourceMetadataOptions): ProtectedResourceMetadata => ({
  resource: getMcpResourceUrl(baseUrl),
  authorization_servers: authorizationServers,
  bearer_methods_supported: ['header'],
  scopes_supported: [],
  resource_name: 'Documenso MCP',
  resource_documentation: `${trimTrailingSlash(baseUrl)}${MCP_DOCUMENTATION_PATH}`,
});

type BuildWwwAuthenticateHeaderOptions = {
  baseUrl: string;

  /**
   * RFC 6750 error code. Omitted when the request carried no credentials at all,
   * as the RFC requires.
   */
  error?: 'invalid_request' | 'invalid_token' | 'insufficient_scope';
  errorDescription?: string;
};

const quote = (value: string) => `"${value.replace(/["\\]/g, '')}"`;

/**
 * Build the `WWW-Authenticate` challenge returned with a 401. Carries the
 * `resource_metadata` parameter so MCP clients can discover how to authenticate.
 */
export const buildWwwAuthenticateHeader = ({
  baseUrl,
  error,
  errorDescription,
}: BuildWwwAuthenticateHeaderOptions): string => {
  const parts = [`realm=${quote('documenso')}`];

  if (error) {
    parts.push(`error=${quote(error)}`);
  }

  if (errorDescription) {
    parts.push(`error_description=${quote(errorDescription)}`);
  }

  parts.push(`resource_metadata=${quote(getProtectedResourceMetadataUrl(baseUrl))}`);

  return `Bearer ${parts.join(', ')}`;
};

import { describe, expect, it } from 'vitest';

import {
  buildProtectedResourceMetadata,
  buildWwwAuthenticateHeader,
  getMcpResourceUrl,
  getProtectedResourceMetadataUrl,
  parseAuthorizationServers,
} from './protected-resource-metadata';

const BASE_URL = 'https://sign.smartroofing.ai';

describe('protected resource metadata (RFC 9728)', () => {
  it('derives the canonical resource and metadata URLs from the web app URL', () => {
    expect(getMcpResourceUrl(BASE_URL)).toBe('https://sign.smartroofing.ai/api/mcp');
    expect(getMcpResourceUrl(`${BASE_URL}/`)).toBe('https://sign.smartroofing.ai/api/mcp');
    expect(getProtectedResourceMetadataUrl(BASE_URL)).toBe(
      'https://sign.smartroofing.ai/.well-known/oauth-protected-resource/api/mcp',
    );
  });

  it('builds a metadata document with header bearer tokens and no authorization servers by default', () => {
    expect(buildProtectedResourceMetadata({ baseUrl: BASE_URL })).toEqual({
      resource: 'https://sign.smartroofing.ai/api/mcp',
      authorization_servers: [],
      bearer_methods_supported: ['header'],
      scopes_supported: [],
      resource_name: 'SR Sign MCP',
      resource_documentation: 'https://sign.smartroofing.ai/docs/developers/mcp',
    });
  });

  it('advertises configured authorization servers', () => {
    const metadata = buildProtectedResourceMetadata({
      baseUrl: BASE_URL,
      authorizationServers: parseAuthorizationServers(' https://auth.example.com/ , not-a-url, ftp://x.y '),
    });

    expect(metadata.authorization_servers).toEqual(['https://auth.example.com']);
  });

  it('returns no authorization servers for an unset variable', () => {
    expect(parseAuthorizationServers(undefined)).toEqual([]);
    expect(parseAuthorizationServers('')).toEqual([]);
  });
});

describe('buildWwwAuthenticateHeader', () => {
  it('omits the error parameter when no credentials were presented', () => {
    const header = buildWwwAuthenticateHeader({ baseUrl: BASE_URL, errorDescription: 'Token required' });

    expect(header).toBe(
      'Bearer realm="sr-sign", error_description="Token required", resource_metadata="https://sign.smartroofing.ai/.well-known/oauth-protected-resource/api/mcp"',
    );
  });

  it('includes invalid_token and strips quotes from descriptions', () => {
    const header = buildWwwAuthenticateHeader({
      baseUrl: BASE_URL,
      error: 'invalid_token',
      errorDescription: 'Expired "token"',
    });

    expect(header).toContain('error="invalid_token"');
    expect(header).toContain('error_description="Expired token"');
    expect(header).toContain(
      'resource_metadata="https://sign.smartroofing.ai/.well-known/oauth-protected-resource/api/mcp"',
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAgentProtocolSettingsMock = vi.fn();
const authenticateMcpRequestMock = vi.fn();

vi.mock('@documenso/lib/server-only/site-settings/get-agent-protocol-settings', () => ({
  getAgentProtocolSettings: (...args: unknown[]) => getAgentProtocolSettingsMock(...args),
}));

vi.mock('./auth/authenticate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./auth/authenticate')>()),
  authenticateMcpRequest: (...args: unknown[]) => authenticateMcpRequestMock(...args),
}));

const { mcpRoute, mcpWellKnownRoute } = await import('./hono');
const { Hono } = await import('hono');

const app = new Hono().route('/api/mcp', mcpRoute).route('/.well-known/oauth-protected-resource', mcpWellKnownRoute);

const initialize = () =>
  app.request('https://sign.example.com/api/mcp', {
    method: 'POST',
    headers: {
      authorization: 'Bearer api_x',
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });

describe('MCP site-setting kill switch and access flag', () => {
  let previousEnabled: string | undefined;
  let previousWebAppUrl: string | undefined;

  beforeEach(() => {
    previousEnabled = process.env.NEXT_PUBLIC_MCP_ENABLED;
    previousWebAppUrl = process.env.NEXT_PUBLIC_WEBAPP_URL;
    process.env.NEXT_PUBLIC_MCP_ENABLED = 'true';
    process.env.NEXT_PUBLIC_WEBAPP_URL = 'https://sign.example.com';
    getAgentProtocolSettingsMock.mockReset();
    authenticateMcpRequestMock.mockReset();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_MCP_ENABLED = previousEnabled;
    process.env.NEXT_PUBLIC_WEBAPP_URL = previousWebAppUrl;
  });

  it('answers 503 MCP_DISABLED before authenticating when the switch is off', async () => {
    getAgentProtocolSettingsMock.mockResolvedValue({ mcpEnabled: false, acpEnabled: true });

    const response = await initialize();

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      error: 'MCP_DISABLED',
      message: expect.stringMatching(/disabled by an administrator/),
      error_description: expect.stringMatching(/disabled by an administrator/),
    });
    expect(authenticateMcpRequestMock).not.toHaveBeenCalled();

    const metadata = await app.request('https://sign.example.com/.well-known/oauth-protected-resource/api/mcp');
    expect(metadata.status).toBe(503);
  });

  it('still serves the protected resource metadata while enabled', async () => {
    getAgentProtocolSettingsMock.mockResolvedValue({ mcpEnabled: true, acpEnabled: false });

    const metadata = await app.request('https://sign.example.com/.well-known/oauth-protected-resource/api/mcp');

    expect(metadata.status).toBe(200);
    await expect(metadata.json()).resolves.toMatchObject({ resource: 'https://sign.example.com/api/mcp' });
  });

  it('returns 403 mcp_access_denied when the organisation lacks the mcpAccess flag', async () => {
    getAgentProtocolSettingsMock.mockResolvedValue({ mcpEnabled: true, acpEnabled: true });
    authenticateMcpRequestMock.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'mcp_access_denied',
      description: 'MCP server access is not enabled for this organisation.',
    });

    const response = await initialize();

    expect(response.status).toBe(403);
    expect(response.headers.get('www-authenticate')).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: 'mcp_access_denied',
      error_description: 'MCP server access is not enabled for this organisation.',
    });
  });

  it('keeps the 401 challenge for invalid tokens', async () => {
    getAgentProtocolSettingsMock.mockResolvedValue({ mcpEnabled: true, acpEnabled: true });
    authenticateMcpRequestMock.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'invalid_token',
      description: 'Invalid API token',
    });

    const response = await initialize();

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });
});

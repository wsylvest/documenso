import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAgentProtocolSettingsMock = vi.fn();

vi.mock('@documenso/lib/server-only/site-settings/get-agent-protocol-settings', () => ({
  getAgentProtocolSettings: (...args: unknown[]) => getAgentProtocolSettingsMock(...args),
}));

vi.mock('@documenso/lib/server-only/public-api/get-api-token-by-token', () => ({
  getApiTokenByToken: vi.fn(),
}));

const { acp, agentCardHandler } = await import('./app');
const { Hono } = await import('hono');

const app = new Hono().route('/api/acp', acp).get('/.well-known/agent-card.json', agentCardHandler);

const expectDisabledBody = async (response: Response) => {
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toBe('no-store');

  await expect(response.json()).resolves.toEqual({
    error: 'ACP_DISABLED',
    message: expect.stringMatching(/disabled by an administrator/),
    code: 'server_error',
    data: { code: 'ACP_DISABLED' },
  });
};

describe('ACP site-setting kill switch', () => {
  beforeEach(() => {
    getAgentProtocolSettingsMock.mockReset();
  });

  it('serves discovery and the agent card while ACP is enabled', async () => {
    getAgentProtocolSettingsMock.mockResolvedValue({ mcpEnabled: true, acpEnabled: true });

    const ping = await app.request('https://sign.example.com/api/acp/ping');
    expect(ping.status).toBe(200);

    const agents = await app.request('https://sign.example.com/api/acp/agents');
    expect(agents.status).toBe(200);

    const card = await app.request('https://sign.example.com/.well-known/agent-card.json');
    expect(card.status).toBe(200);
  });

  it('answers 503 ACP_DISABLED on every route, including discovery and the root agent card', async () => {
    getAgentProtocolSettingsMock.mockResolvedValue({ mcpEnabled: true, acpEnabled: false });

    await expectDisabledBody(await app.request('https://sign.example.com/api/acp/ping'));
    await expectDisabledBody(await app.request('https://sign.example.com/api/acp/agents'));
    await expectDisabledBody(await app.request('https://sign.example.com/.well-known/agent-card.json'));
    await expectDisabledBody(
      await app.request('https://sign.example.com/api/acp/runs', {
        method: 'POST',
        headers: { authorization: 'Bearer api_x', 'content-type': 'application/json' },
        body: JSON.stringify({ agent_name: 'signing-status', input: [] }),
      }),
    );
  });

  it('is independent of the MCP switch', async () => {
    getAgentProtocolSettingsMock.mockResolvedValue({ mcpEnabled: false, acpEnabled: true });

    const ping = await app.request('https://sign.example.com/api/acp/ping');
    expect(ping.status).toBe(200);
  });
});

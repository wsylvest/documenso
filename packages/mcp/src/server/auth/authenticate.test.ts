import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getApiTokenByTokenMock = vi.fn();
const getOrganisationClaimByTeamIdMock = vi.fn();

vi.mock('@documenso/lib/server-only/public-api/get-api-token-by-token', () => ({
  getApiTokenByToken: (...args: unknown[]) => getApiTokenByTokenMock(...args),
}));

vi.mock('@documenso/lib/server-only/organisation/get-organisation-claims', () => ({
  getOrganisationClaimByTeamId: (...args: unknown[]) => getOrganisationClaimByTeamIdMock(...args),
}));

const { authenticateMcpRequest, hasMcpAccess, MCP_ACCESS_DENIED_ERROR, mapApiTokenToMcpAuth, toAuthInfo } =
  await import('./authenticate');

type ApiTokenLike = import('./authenticate').ApiTokenLike;

const apiToken: ApiTokenLike = {
  id: 42,
  teamId: 7,
  user: { id: 3, email: 'staff@smartroofing.ai', name: 'Staff Member' },
  team: { id: 7, name: 'SmartRoofing AI', url: 'smartroofing', organisationId: 'org_1' },
};

const requestWith = (authorization?: string) =>
  new Request('https://sign.smartroofing.ai/api/mcp', {
    method: 'POST',
    headers: authorization ? { authorization } : {},
  });

describe('mapApiTokenToMcpAuth', () => {
  it('maps the token to the user and team it is scoped to', () => {
    expect(mapApiTokenToMcpAuth(apiToken)).toEqual({
      apiTokenId: 42,
      teamId: 7,
      user: { id: 3, email: 'staff@smartroofing.ai', name: 'Staff Member' },
      team: { id: 7, name: 'SmartRoofing AI', url: 'smartroofing', organisationId: 'org_1' },
    });
  });

  it('refuses tokens without a team', () => {
    expect(() => mapApiTokenToMcpAuth({ ...apiToken, team: null })).toThrowError(/not scoped to a team/);
  });
});

describe('toAuthInfo', () => {
  it('never carries the raw secret and exposes the identity in extra', () => {
    const authInfo = toAuthInfo(mapApiTokenToMcpAuth(apiToken));

    expect(authInfo.token).toBe('api-token:42');
    expect(authInfo.token).not.toContain('api_');
    expect(authInfo.clientId).toBe('api-token:42');
    expect(authInfo.scopes).toEqual(['team:7']);
    expect(authInfo.extra).toEqual({ authMethod: 'api_token', apiTokenId: 42, userId: 3, teamId: 7 });
  });
});

describe('hasMcpAccess', () => {
  beforeEach(() => {
    getOrganisationClaimByTeamIdMock.mockReset();
  });

  it('is granted only by an explicit mcpAccess flag on the organisation claim', async () => {
    getOrganisationClaimByTeamIdMock.mockResolvedValue({ flags: { mcpAccess: true } });
    await expect(hasMcpAccess(7)).resolves.toBe(true);

    getOrganisationClaimByTeamIdMock.mockResolvedValue({ flags: { acpAccess: true } });
    await expect(hasMcpAccess(7)).resolves.toBe(false);

    getOrganisationClaimByTeamIdMock.mockResolvedValue({ flags: {} });
    await expect(hasMcpAccess(7)).resolves.toBe(false);

    expect(getOrganisationClaimByTeamIdMock).toHaveBeenCalledWith({ teamId: 7 });
  });
});

describe('authenticateMcpRequest', () => {
  beforeEach(() => {
    getApiTokenByTokenMock.mockReset();
    getOrganisationClaimByTeamIdMock.mockReset();
    getOrganisationClaimByTeamIdMock.mockResolvedValue({ flags: { mcpAccess: true } });
  });

  it('returns a 401 challenge without an error code when no credentials are sent', async () => {
    const result = await authenticateMcpRequest(requestWith());

    expect(result).toMatchObject({ ok: false, status: 401, error: null });
    expect(getApiTokenByTokenMock).not.toHaveBeenCalled();
  });

  it('returns invalid_token when the token lookup fails', async () => {
    getApiTokenByTokenMock.mockRejectedValue(
      new AppError(AppErrorCode.EXPIRED_CODE, { message: 'Expired token', statusCode: 401 }),
    );

    const result = await authenticateMcpRequest(requestWith('Bearer api_old'));

    expect(result).toMatchObject({ ok: false, status: 401, error: 'invalid_token', description: 'Expired token' });
    expect(getOrganisationClaimByTeamIdMock).not.toHaveBeenCalled();
  });

  it('authenticates a token whose organisation has MCP access', async () => {
    getApiTokenByTokenMock.mockResolvedValue({ ...apiToken, user: { ...apiToken.user, disabled: false } });

    const result = await authenticateMcpRequest(requestWith('Bearer api_valid'));

    expect(result).toMatchObject({ ok: true, auth: { apiTokenId: 42, teamId: 7 } });
    expect(getApiTokenByTokenMock).toHaveBeenCalledWith({ token: 'api_valid', bypassRateLimit: true });
    expect(getOrganisationClaimByTeamIdMock).toHaveBeenCalledWith({ teamId: 7 });
  });

  it('rejects with 403 mcp_access_denied when the organisation lacks the mcpAccess flag', async () => {
    getApiTokenByTokenMock.mockResolvedValue({ ...apiToken, user: { ...apiToken.user, disabled: false } });
    getOrganisationClaimByTeamIdMock.mockResolvedValue({ flags: { acpAccess: true } });

    const result = await authenticateMcpRequest(requestWith('Bearer api_valid'));

    expect(result).toMatchObject({ ok: false, status: 403, error: MCP_ACCESS_DENIED_ERROR });
    expect(result.ok === false && result.description).toMatch(/MCP server access is not enabled/);
  });
});

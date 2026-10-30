import { describe, expect, it } from 'vitest';

import { type ApiTokenLike, mapApiTokenToMcpAuth, toAuthInfo } from './authenticate';

const apiToken: ApiTokenLike = {
  id: 42,
  teamId: 7,
  user: { id: 3, email: 'staff@smartroofing.ai', name: 'Staff Member' },
  team: { id: 7, name: 'SmartRoofing AI', url: 'smartroofing', organisationId: 'org_1' },
};

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

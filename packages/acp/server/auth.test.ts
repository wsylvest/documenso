import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getApiTokenByTokenMock = vi.fn();

vi.mock('@documenso/lib/server-only/public-api/get-api-token-by-token', () => ({
  getApiTokenByToken: (...args: unknown[]) => getApiTokenByTokenMock(...args),
}));

const { buildApiRequestMetadata, parseAuthorizationHeader, resolveAcpPrincipal } = await import('./auth');

const requestMetadata = { ipAddress: '203.0.113.7', userAgent: 'acp-client/1.0' };

const baseToken = {
  id: 42,
  teamId: 7,
  user: { id: 3, name: 'Ada', email: 'ada@example.com', disabled: false },
  team: { id: 7, name: 'Roofing Sales' },
};

describe('parseAuthorizationHeader', () => {
  it('accepts "Bearer api_x" and bare "api_x"', () => {
    expect(parseAuthorizationHeader('Bearer api_abc')).toBe('api_abc');
    expect(parseAuthorizationHeader('api_abc')).toBe('api_abc');
  });

  it('returns null for missing or empty headers', () => {
    expect(parseAuthorizationHeader(undefined)).toBeNull();
    expect(parseAuthorizationHeader('')).toBeNull();
    expect(parseAuthorizationHeader('Bearer ')).toBeNull();
  });
});

describe('buildApiRequestMetadata', () => {
  it('attributes team tokens to the team, like API V2', () => {
    const metadata = buildApiRequestMetadata(baseToken, requestMetadata);

    expect(metadata).toEqual({
      requestMetadata,
      source: 'apiV2',
      auth: 'api',
      auditUser: { id: null, email: null, name: 'Roofing Sales' },
    });
  });

  it('attributes personal tokens to the user', () => {
    const metadata = buildApiRequestMetadata({ ...baseToken, team: null }, requestMetadata);

    expect(metadata.auditUser).toEqual({ id: 3, email: 'ada@example.com', name: 'Ada' });
  });
});

describe('resolveAcpPrincipal', () => {
  beforeEach(() => {
    getApiTokenByTokenMock.mockReset();
  });

  it('rejects requests without a token with a 401', async () => {
    await expect(resolveAcpPrincipal({ authorizationHeader: null, requestMetadata })).rejects.toMatchObject({
      code: AppErrorCode.UNAUTHORIZED,
      statusCode: 401,
    });

    expect(getApiTokenByTokenMock).not.toHaveBeenCalled();
  });

  it('maps a valid token onto a team-scoped principal', async () => {
    getApiTokenByTokenMock.mockResolvedValue(baseToken);

    const principal = await resolveAcpPrincipal({ authorizationHeader: 'Bearer api_valid', requestMetadata });

    expect(getApiTokenByTokenMock).toHaveBeenCalledWith({ token: 'api_valid' });
    expect(principal.teamId).toBe(7);
    expect(principal.apiTokenId).toBe(42);
    expect(principal.user).toEqual({ id: 3, name: 'Ada', email: 'ada@example.com' });
    expect(principal.metadata.auth).toBe('api');
    expect(principal.metadata.source).toBe('apiV2');
  });

  it('propagates token lookup failures unchanged', async () => {
    getApiTokenByTokenMock.mockRejectedValue(
      new AppError(AppErrorCode.EXPIRED_CODE, { message: 'Expired token', statusCode: 401 }),
    );

    await expect(resolveAcpPrincipal({ authorizationHeader: 'Bearer api_old', requestMetadata })).rejects.toMatchObject(
      {
        code: AppErrorCode.EXPIRED_CODE,
      },
    );
  });

  it('rejects disabled users', async () => {
    getApiTokenByTokenMock.mockResolvedValue({ ...baseToken, user: { ...baseToken.user, disabled: true } });

    await expect(resolveAcpPrincipal({ authorizationHeader: 'Bearer api_x', requestMetadata })).rejects.toMatchObject({
      code: 'ACCOUNT_DISABLED',
      statusCode: 403,
    });
  });
});

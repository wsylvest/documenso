import { base32 } from '@scure/base';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { symmetricEncrypt } from '../../universal/crypto';
import { generateTwoFactorCredentialsFromEmail } from './email/generate-2fa-credentials-from-email';
import { generateTwoFactorTokenFromEmail } from './email/generate-2fa-token-from-email';
import { validateTwoFactorTokenFromEmail } from './email/validate-2fa-token-from-email';
import { createTOTPKeyURI, generateHOTP } from './otp';
import { verifyTwoFactorAuthenticationToken } from './verify-2fa-token';

vi.mock('../../constants/crypto', () => ({
  DOCUMENSO_ENCRYPTION_KEY: 'otp-migration-test-key',
}));

afterEach(() => vi.restoreAllMocks());

describe('native OTP compatibility', () => {
  const secret = Buffer.from('12345678901234567890');

  it('matches RFC 4226 Appendix D and RFC 6238 SHA-1 vectors at six digits', () => {
    const codes = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    codes.forEach((code, counter) => {
      expect(generateHOTP(secret, counter)).toBe(code);
    });

    for (const [time, code] of [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
      [20000000000, '353130'],
    ] as const) {
      expect(generateHOTP(secret, Math.floor(time / 30))).toBe(code);
    }

    expect(() => generateHOTP(secret, -1)).toThrow('Invalid OTP counter');
    expect(() => generateHOTP(secret, 1.5)).toThrow('Invalid OTP counter');
  });

  it('keeps authenticator provisioning compatible and escapes issuer/account names', () => {
    const uri = new URL(createTOTPKeyURI('Example & Co', 'user+test@example.com', secret));
    expect(decodeURIComponent(uri.pathname)).toBe('/Example & Co:user+test@example.com');
    expect(Object.fromEntries(uri.searchParams)).toEqual({
      issuer: 'Example & Co',
      algorithm: 'SHA1',
      secret: base32.encode(secret).replace(/=+$/, ''),
      period: '30',
      digits: '6',
    });
  });

  it('accepts existing encrypted secrets and preserves the configured backwards-only window', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(60_000);
    const user = {
      id: 1,
      twoFactorSecret: symmetricEncrypt({ key: 'otp-migration-test-key', data: base32.encode(secret) }),
    };
    await expect(verifyTwoFactorAuthenticationToken({ user, totpCode: '359152' })).resolves.toBe(true);
    await expect(verifyTwoFactorAuthenticationToken({ user, totpCode: '287082' })).resolves.toBe(false);
    await expect(verifyTwoFactorAuthenticationToken({ user, totpCode: '287082', window: 2 })).resolves.toBe(true);
    await expect(verifyTwoFactorAuthenticationToken({ user, totpCode: '969429', window: 2 })).resolves.toBe(false);
    await expect(verifyTwoFactorAuthenticationToken({ user, totpCode: 'bad-code' })).resolves.toBe(false);
  });

  it('keeps email codes tied to the recipient, envelope, and expiry window', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(60_000);
    const identity = { email: 'recipient@example.com', envelopeId: 'envelope_test' };
    const credentials = generateTwoFactorCredentialsFromEmail(identity);
    const code = await generateTwoFactorTokenFromEmail(identity);
    expect(code).toBe(generateHOTP(credentials.secret, 2));
    await expect(validateTwoFactorTokenFromEmail({ ...identity, code })).resolves.toBe(true);
    await expect(validateTwoFactorTokenFromEmail({ ...identity, email: 'other@example.com', code })).resolves.toBe(
      false,
    );
    await expect(validateTwoFactorTokenFromEmail({ ...identity, envelopeId: 'other', code })).resolves.toBe(false);
    now.mockReturnValue(90_000);
    await expect(validateTwoFactorTokenFromEmail({ ...identity, code })).resolves.toBe(false);
    await expect(validateTwoFactorTokenFromEmail({ ...identity, code, window: 2 })).resolves.toBe(true);
  });
});

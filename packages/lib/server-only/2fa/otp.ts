import { createHmac } from 'node:crypto';

import { base32 } from '@scure/base';

import { AppError, AppErrorCode } from '../../errors/app-error';

// RFC 4226: preserve the six-digit SHA-1 HOTP used by existing authenticator and email secrets.
export const generateHOTP = (key: Uint8Array, counter: number): string => {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new AppError(AppErrorCode.INVALID_BODY, { message: 'Invalid OTP counter' });
  }

  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', key).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;

  return code.toString().padStart(6, '0');
};

export const createTOTPKeyURI = (issuer: string, accountName: string, key: Uint8Array): string => {
  const params = new URLSearchParams({
    issuer,
    algorithm: 'SHA1',
    secret: base32.encode(key).replace(/=+$/, ''),
    period: '30',
    digits: '6',
  });

  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?${params}`;
};

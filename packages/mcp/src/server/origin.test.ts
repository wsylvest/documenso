import { describe, expect, it } from 'vitest';

import { parseAllowedOrigins, validateMcpOrigin } from './origin';

const BASE_URL = 'https://sign.smartroofing.ai';

describe('validateMcpOrigin', () => {
  it('allows requests without an Origin header (non-browser clients)', () => {
    expect(validateMcpOrigin({ origin: undefined, baseUrl: BASE_URL })).toBe(true);
    expect(validateMcpOrigin({ origin: null, baseUrl: BASE_URL })).toBe(true);
    expect(validateMcpOrigin({ origin: '', baseUrl: BASE_URL })).toBe(true);
  });

  it('allows the web app origin', () => {
    expect(validateMcpOrigin({ origin: 'https://sign.smartroofing.ai', baseUrl: BASE_URL })).toBe(true);
    expect(validateMcpOrigin({ origin: 'https://sign.smartroofing.ai', baseUrl: `${BASE_URL}/` })).toBe(true);
  });

  it('rejects other origins unless allow-listed', () => {
    expect(validateMcpOrigin({ origin: 'https://evil.example.com', baseUrl: BASE_URL })).toBe(false);
    expect(validateMcpOrigin({ origin: 'http://sign.smartroofing.ai', baseUrl: BASE_URL })).toBe(false);

    expect(
      validateMcpOrigin({
        origin: 'https://app.example.com',
        baseUrl: BASE_URL,
        allowedOrigins: parseAllowedOrigins('https://app.example.com/, junk'),
      }),
    ).toBe(true);
  });

  it('rejects malformed origins', () => {
    expect(validateMcpOrigin({ origin: 'null', baseUrl: BASE_URL })).toBe(false);
    expect(validateMcpOrigin({ origin: 'not a url', baseUrl: BASE_URL })).toBe(false);
  });
});

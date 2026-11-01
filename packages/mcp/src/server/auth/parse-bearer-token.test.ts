import { describe, expect, it } from 'vitest';

import { isApiToken, parseBearerToken } from './parse-bearer-token';

describe('parseBearerToken', () => {
  it('extracts the token from a Bearer header', () => {
    expect(parseBearerToken('Bearer api_abc123')).toBe('api_abc123');
  });

  it('is case insensitive on the scheme and tolerant of whitespace', () => {
    expect(parseBearerToken('  bearer   api_abc123  ')).toBe('api_abc123');
  });

  it('accepts a bare token like the API V2 middleware', () => {
    expect(parseBearerToken('api_abc123')).toBe('api_abc123');
  });

  it('returns null for missing, empty or scheme-only headers', () => {
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken(undefined)).toBeNull();
    expect(parseBearerToken('')).toBeNull();
    expect(parseBearerToken('   ')).toBeNull();
    expect(parseBearerToken('Bearer')).toBeNull();
    expect(parseBearerToken('Bearer   ')).toBeNull();
  });

  it('recognises SR Sign API tokens', () => {
    expect(isApiToken('api_abc')).toBe(true);
    expect(isApiToken('eyJhbGciOi')).toBe(false);
  });
});

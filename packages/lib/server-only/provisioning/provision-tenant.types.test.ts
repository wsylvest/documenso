import { describe, expect, test } from 'vitest';

import {
  isProvisioningSecretValid,
  parseBearer,
  ZProvisionTenantRequestSchema,
  ZTenantSlugSchema,
} from './provision-tenant.types';

const SECRET = 'a'.repeat(40);

describe('isProvisioningSecretValid', () => {
  test('accepts the configured secret', () => {
    expect(isProvisioningSecretValid(SECRET, SECRET)).toBe(true);
  });

  test('rejects a different or missing secret', () => {
    expect(isProvisioningSecretValid(SECRET, 'b'.repeat(40))).toBe(false);
    expect(isProvisioningSecretValid(SECRET, undefined)).toBe(false);
  });

  test('is off when the configured secret is unset or too short', () => {
    expect(isProvisioningSecretValid(undefined, SECRET)).toBe(false);
    expect(isProvisioningSecretValid('short', 'short')).toBe(false);
  });
});

describe('parseBearer', () => {
  test('reads a bearer token and nothing else', () => {
    expect(parseBearer('Bearer abc')).toBe('abc');
    expect(parseBearer('abc')).toBeUndefined();
    expect(parseBearer(undefined)).toBeUndefined();
  });
});

describe('ZTenantSlugSchema', () => {
  test.each(['rocket-roofing', 'abc', 'a1-b2'])('accepts %s', (slug) => {
    expect(ZTenantSlugSchema.safeParse(slug).success).toBe(true);
  });

  test.each(['ab', 'Rocket', '-a-b', 'a--b', 'a_b', 'a b', 'a-'])('rejects %s', (slug) => {
    expect(ZTenantSlugSchema.safeParse(slug).success).toBe(false);
  });
});

describe('ZProvisionTenantRequestSchema', () => {
  const base = {
    slug: 'acme',
    name: 'Acme',
    webhookUrl: 'https://box.example/api/signing-webhooks/documenso',
    webhookSecret: 's'.repeat(32),
  };

  test('defaults rotateToken to false', () => {
    expect(ZProvisionTenantRequestSchema.parse(base).rotateToken).toBe(false);
  });

  test('rejects a short webhook secret', () => {
    expect(ZProvisionTenantRequestSchema.safeParse({ ...base, webhookSecret: 'short' }).success).toBe(false);
  });
});

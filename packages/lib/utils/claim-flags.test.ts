import { afterEach, beforeEach, expect, test } from 'vitest';

import { ZClaimFlagsSchema } from '../types/subscription';
import { isClaimFlagEnabled, isExplicitOnlyClaimFlag } from './claim-flags';

const EXPLICIT_ONLY_FLAGS = ['disableEmails', 'allowLegacyEnvelopes', 'mcpAccess', 'acpAccess'];

let previousBillingFlag: string | undefined;

beforeEach(() => {
  previousBillingFlag = process.env.NEXT_PUBLIC_FEATURE_BILLING_ENABLED;
});

afterEach(() => {
  if (previousBillingFlag === undefined) {
    delete process.env.NEXT_PUBLIC_FEATURE_BILLING_ENABLED;
  } else {
    process.env.NEXT_PUBLIC_FEATURE_BILLING_ENABLED = previousBillingFlag;
  }
});

test('billing-disabled capabilities ignore stored entitlements except explicit-only flags', () => {
  for (const billing of ['', 'false', 'true']) {
    process.env.NEXT_PUBLIC_FEATURE_BILLING_ENABLED = billing;

    for (const key of ZClaimFlagsSchema.keyof().options) {
      const enabledByDefault = billing !== 'true' && !EXPLICIT_ONLY_FLAGS.includes(key);

      expect(isClaimFlagEnabled(undefined, key), `${billing}: ${key}`).toBe(enabledByDefault);
      expect(isClaimFlagEnabled({ [key]: false }, key), `${billing}: ${key}`).toBe(enabledByDefault);
      expect(isClaimFlagEnabled({ [key]: true }, key), `${billing}: ${key}`).toBe(true);
    }
  }
});

test('allowLegacyEnvelopes stays off on a billing-disabled instance until explicitly granted', () => {
  process.env.NEXT_PUBLIC_FEATURE_BILLING_ENABLED = '';

  expect(isClaimFlagEnabled({}, 'allowLegacyEnvelopes')).toBe(false);
  expect(isClaimFlagEnabled({ allowLegacyEnvelopes: true }, 'allowLegacyEnvelopes')).toBe(true);
  expect(isClaimFlagEnabled({}, 'embedSigning')).toBe(true);
});

test('mcpAccess and acpAccess stay off on a billing-disabled instance until explicitly granted', () => {
  process.env.NEXT_PUBLIC_FEATURE_BILLING_ENABLED = '';

  expect(isClaimFlagEnabled({}, 'mcpAccess')).toBe(false);
  expect(isClaimFlagEnabled({}, 'acpAccess')).toBe(false);
  expect(isClaimFlagEnabled({ mcpAccess: true }, 'mcpAccess')).toBe(true);
  expect(isClaimFlagEnabled({ acpAccess: true }, 'acpAccess')).toBe(true);
});

test('isExplicitOnlyClaimFlag matches the explicit-only set', () => {
  for (const key of ZClaimFlagsSchema.keyof().options) {
    expect(isExplicitOnlyClaimFlag(key), key).toBe(EXPLICIT_ONLY_FLAGS.includes(key));
  }
});

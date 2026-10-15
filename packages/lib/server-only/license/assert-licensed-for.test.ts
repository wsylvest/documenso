import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ZLicenseClaimSchema } from '../../types/license';
import { assertLicensedFor } from './assert-licensed-for';

test('billing-disabled instances need no license; billing-enabled instances still do', async () => {
  const billing = process.env.NEXT_PUBLIC_FEATURE_BILLING_ENABLED;
  const license = process.env.NEXT_PRIVATE_DOCUMENSO_LICENSE_KEY;

  try {
    delete process.env.NEXT_PRIVATE_DOCUMENSO_LICENSE_KEY;
    process.env.NEXT_PUBLIC_FEATURE_BILLING_ENABLED = 'false';

    for (const flag of ZLicenseClaimSchema.keyof().options) {
      await assert.doesNotReject(assertLicensedFor(flag));
    }

    process.env.NEXT_PUBLIC_FEATURE_BILLING_ENABLED = 'true';
    await assert.rejects(assertLicensedFor('instanceCscSigning'), /License does not include/);
  } finally {
    if (billing === undefined) {
      delete process.env.NEXT_PUBLIC_FEATURE_BILLING_ENABLED;
    } else {
      process.env.NEXT_PUBLIC_FEATURE_BILLING_ENABLED = billing;
    }

    if (license === undefined) {
      delete process.env.NEXT_PRIVATE_DOCUMENSO_LICENSE_KEY;
    } else {
      process.env.NEXT_PRIVATE_DOCUMENSO_LICENSE_KEY = license;
    }
  }
});

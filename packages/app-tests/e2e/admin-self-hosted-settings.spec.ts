import { IS_BILLING_ENABLED } from '@documenso/lib/constants/app';
import { prisma } from '@documenso/prisma';
import { seedUser, unseedUser } from '@documenso/prisma/seed/users';
import { expect, test } from '@playwright/test';

import { apiSignin } from './fixtures/authentication';

test('admin billing controls follow billing configuration and self-hosted settings remain editable', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { user, organisation } = await seedUser({ isAdmin: true });
  const isBillingEnabled = IS_BILLING_ENABLED();

  try {
    await prisma.organisationClaim.update({
      where: { id: organisation.organisationClaimId },
      data: { flags: {} },
    });
    await apiSignin({ page, email: user.email, redirectPath: '/admin/organisations' });
    await expect(page.getByRole('columnheader', { name: 'Subscription', exact: true })).toHaveCount(
      isBillingEnabled ? 1 : 0,
    );

    await page.goto(`/admin/organisations/${organisation.id}`);
    await expect(page.getByText('Features and limits', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Stripe customer', exact: true })).toHaveCount(
      isBillingEnabled ? 1 : 0,
    );
    await expect(page.getByLabel('Stripe Customer ID')).toHaveCount(isBillingEnabled ? 1 : 0);

    if (!isBillingEnabled) {
      await expect(
        page.getByText('Your current license does not include these features.', { exact: true }),
      ).toHaveCount(0);
      for (const label of [
        'Unlimited documents',
        'Branding',
        'Email domains',
        'Embed authoring',
        'Embed signing',
        '21 CFR',
        'HIPAA',
        'Authentication portal',
        'Allow Legacy Envelopes',
        'Signing reminders',
        'QES signing',
      ]) {
        await expect(page.getByRole('checkbox', { name: label, exact: true })).toBeChecked();
      }
      const disableEmails = page.getByRole('checkbox', { name: 'Disable emails', exact: true });
      await expect(disableEmails).not.toBeChecked();
      await expect(disableEmails).toBeEnabled();

      await page.getByRole('button', { name: /Global Settings/ }).click();
      await page.getByRole('link', { name: 'Edit branding', exact: true }).click();
      await page.getByTestId('enable-branding').click();
      await page.getByRole('option', { name: 'Yes', exact: true }).click();
      await page.locator('input[name="brandingUrl"]').fill('https://example.com');
      await page.locator('textarea[name="brandingCompanyDetails"]').fill('Self-hosted branding test');
      await page.getByRole('button', { name: /Save/ }).click();

      await expect
        .poll(async () => {
          const settings = await prisma.organisation.findUniqueOrThrow({
            where: { id: organisation.id },
            include: { organisationGlobalSettings: true },
          });
          return settings.organisationGlobalSettings.brandingCompanyDetails;
        })
        .toBe('Self-hosted branding test');

      await page.goto(`/o/${organisation.url}/settings/email-domains`);
      await expect(page.getByRole('heading', { name: 'Email Domains', exact: true })).toBeVisible();
      await page.goto(`/o/${organisation.url}/settings/sso`);
      await page.locator('input[name="clientId"]').fill('self-hosted-test-client');
      await page.getByRole('button', { name: 'Update', exact: true }).click();
      await expect(page.getByText('Provider has been updated successfully', { exact: true })).toBeVisible();

      await page.goto(`/admin/organisations/${organisation.id}`);
      await page.getByRole('button', { name: /Global Settings/ }).click();
      await page.getByRole('link', { name: 'Edit envelope defaults', exact: true }).click();
      await page.getByTestId('document-date-format-trigger').click();
      await page.getByRole('option').last().click();
      await page.getByRole('button', { name: /Save/ }).click();
      await expect(page.getByText('Your document preferences have been updated', { exact: true })).toBeVisible();
    }

    await page.goto('/admin/stats');
    await expect(page.getByText('Active Subscriptions', { exact: true })).toHaveCount(isBillingEnabled ? 1 : 0);
  } finally {
    await unseedUser(user.id);
  }
});

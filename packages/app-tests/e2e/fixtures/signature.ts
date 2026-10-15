import type { Page } from '@playwright/test';

/**
 * Will open the signature pad dialog and sign it.
 */
export const signSignaturePad = async (page: Page) => {
  await page.waitForTimeout(200);

  await page.getByTestId('signature-pad-dialog-button').click();

  // Click type tab
  await page.getByRole('tab', { name: 'Type' }).click();
  await page.getByTestId('signature-pad-type-input').fill('Signature');

  // Click Next button
  await page.getByRole('button', { name: 'Next' }).click();
};

/**
 * For when the signature pad is already open.
 */
export const signDirectSignaturePad = async (page: Page) => {
  await page.waitForTimeout(200);

  // Click type tab
  await page.getByRole('tab', { name: 'Type' }).click();
  await page.getByTestId('signature-pad-type-input').fill('Signature');
};

/**
 * Accept the ESIGN consumer consent dialog shown when a V2 signing page is
 * opened for a recipient who has not yet consented. No-op when the dialog is
 * not present (direct templates, already consented recipients).
 */
export const acceptElectronicConsent = async (page: Page) => {
  const checkbox = page.getByTestId('electronic-consent-checkbox');

  // The dialog renders after hydration, so wait briefly for it rather than
  // checking visibility synchronously.
  const appeared = await checkbox
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  if (!appeared) {
    return;
  }

  await checkbox.click();
  await page.getByTestId('electronic-consent-continue').click();
  await checkbox.waitFor({ state: 'hidden' });
};

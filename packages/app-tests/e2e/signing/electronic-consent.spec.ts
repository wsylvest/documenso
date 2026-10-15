import { PAPER_COPY_REQUESTED_REJECTION_REASON } from '@documenso/lib/constants/electronic-consent';
import { DOCUMENT_AUDIT_LOG_TYPE } from '@documenso/lib/types/document-audit-logs';
import { prisma } from '@documenso/prisma';
import { expect, test } from '@playwright/test';
import { SigningStatus } from '@prisma/client';

import { apiSeedPendingDocument } from '../fixtures/api-seeds';

test.describe('[ELECTRONIC_CONSENT]: ESIGN consumer consent gate', () => {
  test('blocks signing until the recipient agrees, then records consent once', async ({ page, request }) => {
    const { distributeResult, envelope } = await apiSeedPendingDocument(request, {
      recipients: [{ email: 'consent-signer@test.documenso.com', name: 'Consent Signer' }],
    });

    const [recipient] = distributeResult.recipients;

    await page.goto(`/sign/${recipient.token}`);

    const dialog = page.getByTestId('electronic-consent-dialog');
    const checkbox = page.getByTestId('electronic-consent-checkbox');
    const continueButton = page.getByTestId('electronic-consent-continue');

    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Consent to do business electronically')).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'electronic signature disclosure' })).toHaveAttribute(
      'href',
      '/articles/signature-disclosure',
    );

    // Escape must not dismiss the gate.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();

    await expect(continueButton).toBeDisabled();

    await checkbox.click();
    await expect(continueButton).toBeEnabled();
    await continueButton.click();

    await expect(dialog).toBeHidden();

    await expect(async () => {
      const dbRecipient = await prisma.recipient.findUniqueOrThrow({ where: { id: recipient.id } });

      expect(dbRecipient.electronicConsentAt).not.toBeNull();
    }).toPass();

    const consentLogs = await prisma.documentAuditLog.findMany({
      where: {
        envelopeId: envelope.id,
        type: DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_CONSENTED,
      },
    });

    expect(consentLogs).toHaveLength(1);
    expect(consentLogs[0].email).toBe(recipient.email);
    // Local browsers send no forwarding headers, so only the user agent is asserted here.
    expect(consentLogs[0].userAgent).toContain('Mozilla');
    expect((consentLogs[0].data as { disclosureVersion: string }).disclosureVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Reloading does not ask again.
    await page.reload();
    await expect(page.getByTestId('electronic-consent-dialog')).toHaveCount(0);
  });

  test('offers a paper copy, which rejects the document with a recognisable reason', async ({ page, request }) => {
    const { distributeResult, envelope } = await apiSeedPendingDocument(request, {
      recipients: [{ email: 'paper-signer@test.documenso.com', name: 'Paper Signer' }],
    });

    const [recipient] = distributeResult.recipients;

    await page.goto(`/sign/${recipient.token}`);

    await expect(page.getByTestId('electronic-consent-dialog')).toBeVisible();

    await page.getByTestId('electronic-consent-paper-copy').click();

    await page.waitForURL(`**/sign/${recipient.token}/rejected?paper=1`);

    await expect(page.getByRole('heading', { name: 'Paper Copy Requested' })).toBeVisible();
    await expect(page.getByText('would like a paper copy')).toBeVisible();

    const dbRecipient = await prisma.recipient.findUniqueOrThrow({ where: { id: recipient.id } });

    expect(dbRecipient.signingStatus).toBe(SigningStatus.REJECTED);
    expect(dbRecipient.rejectionReason).toBe(PAPER_COPY_REQUESTED_REJECTION_REASON);
    expect(dbRecipient.electronicConsentAt).toBeNull();

    const rejectedLog = await prisma.documentAuditLog.findFirstOrThrow({
      where: { envelopeId: envelope.id, type: DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_REJECTED },
    });

    expect((rejectedLog.data as { reason: string }).reason).toBe(PAPER_COPY_REQUESTED_REJECTION_REASON);
  });
});

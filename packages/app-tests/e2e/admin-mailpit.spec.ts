import { randomUUID } from 'node:crypto';

import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { prisma } from '@documenso/prisma';
import { seedUser, unseedUser } from '@documenso/prisma/seed/users';
import { expect, test } from '@playwright/test';
import { createTransport } from 'nodemailer';

import { apiSignin } from './fixtures/authentication';

test('admins can manage captured mail; other users and cross-origin requests cannot', async ({ page }) => {
  test.skip(
    process.env.NEXT_PRIVATE_MAILPIT_URL !== 'http://127.0.0.1:8025',
    'Requires the native local Mailpit fixture',
  );
  const { user } = await seedUser({ isAdmin: true });
  const subject = `Mailpit admin test ${randomUUID()}`;
  const api = 'http://127.0.0.1:8025/api/v1';
  let messageId: string | undefined;

  try {
    // Always deliver only to the local capture service, never the configured application transport.
    await createTransport({ host: '127.0.0.1', port: 2500, ignoreTLS: true }).sendMail({
      from: 'sender@example.test',
      to: 'recipient@example.test',
      subject,
      text: 'Private test message body',
      html: '<p>Protected HTML body</p><script>parent.document.body.dataset.mailpitExecuted = "yes"</script><img src="https://example.test/tracking" />',
      attachments: [{ filename: 'test.txt', content: 'Local test attachment' }],
    });
    const captured = await (await fetch(`${api}/search?query=${encodeURIComponent(subject)}`)).json();
    messageId = captured.messages[0].ID;
    if (!messageId) {
      throw new Error('Mailpit did not capture the test message');
    }

    await apiSignin({ page, email: user.email, redirectPath: '/admin/mailpit' });
    await expect(page.getByRole('heading', { name: 'Mailpit inbox', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Search emails' }).fill(subject);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get('q') === subject);
    await page.getByRole('link').filter({ hasText: subject }).click();
    await expect(page.getByText('Private test message body', { exact: true })).toBeVisible();
    await expect(page.getByText(/test.txt/)).toBeVisible();
    await page.getByRole('tab', { name: 'HTML preview' }).click();
    await expect(page.frameLocator('iframe').getByText('Protected HTML body')).toBeVisible();
    await expect(page.locator('iframe')).toHaveAttribute('sandbox', '');
    await page.screenshot({ path: '../../tmp/mailpit-admin.png', fullPage: true });
    await expect(page.locator('body')).not.toHaveAttribute('data-mailpit-executed', 'yes');

    const csrf = await page.request.post('/admin/mailpit', {
      headers: { Origin: 'https://untrusted.example' },
      form: { operation: 'delete', id: messageId },
      maxRedirects: 0,
    });
    // React Router may reject the forwarded cross-origin action before our handler.
    expect([400, 403]).toContain(csrf.status());

    await page.getByRole('button', { name: 'Mark unread', exact: true }).click();
    await page.waitForURL((url) => !url.searchParams.has('id'), { timeout: 30_000 });
    await expect(
      page.getByRole('link').filter({ hasText: subject }).getByText('Unread', { exact: true }),
    ).toBeVisible();
    await page.getByRole('link').filter({ hasText: subject }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete message', exact: true }).click();
    await page.waitForURL((url) => !url.searchParams.has('id'), { timeout: 30_000 });
    await expect(page.getByRole('link').filter({ hasText: subject })).toHaveCount(0);

    await prisma.user.update({ where: { id: user.id }, data: { roles: ['USER'] } });
    const forbidden = await page.request.get('/admin/mailpit', { maxRedirects: 0 });
    expect([302, 403]).toContain(forbidden.status());
    const forbiddenDelete = await page.request.post('/admin/mailpit', {
      headers: { Origin: new URL(NEXT_PUBLIC_WEBAPP_URL()).origin },
      form: { operation: 'delete', id: messageId },
      maxRedirects: 0,
    });
    expect([302, 403]).toContain(forbiddenDelete.status());
  } finally {
    if (messageId) {
      await fetch(`${api}/messages`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [messageId] }),
      });
    }
    await unseedUser(user.id);
  }
});

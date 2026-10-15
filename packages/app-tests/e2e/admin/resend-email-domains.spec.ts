import { randomUUID } from 'node:crypto';
import { createEmailDomain } from '@documenso/ee/server-only/lib/create-email-domain';
import { deleteEmailDomain } from '@documenso/ee/server-only/lib/delete-email-domain';
import { saveResendEmailDomain } from '@documenso/ee/server-only/lib/save-resend-email-domain';
import { verifyEmailDomain } from '@documenso/ee/server-only/lib/verify-email-domain';
import { mailer } from '@documenso/email/mailer';
import { encryptEmailTransportConfig } from '@documenso/lib/server-only/email/email-transport-config';
import { getEmailContext } from '@documenso/lib/server-only/email/get-email-context';
import { listResendDomains, requestResendDomains } from '@documenso/lib/server-only/email/resend-domains';
import { getEmailDomainRecords } from '@documenso/lib/utils/email-domains';
import { prisma } from '@documenso/prisma';
import { seedUser, unseedUser } from '@documenso/prisma/seed/users';
import { expect, test } from '@playwright/test';
import { apiSignin } from '../fixtures/authentication';

// Provider calls are mocked; database and domain/sender integration use the real implementations.
test('Resend domains can be created, synced, imported and used without AWS SES or SMTP fallback', async () => {
  const { user, organisation, team } = await seedUser({ isAdmin: true });
  const emailTransportId = `resend-test-${randomUUID()}`;
  const domainName = `${randomUUID()}.example.com`;
  const remoteId = randomUUID();
  const records = [
    { name: 'send', type: 'MX', value: 'feedback-smtp.example.com', priority: 10, ttl: 'Auto', status: 'pending' },
  ];
  let status = 'pending';
  let deny = false;
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  await prisma.emailTransport.create({
    data: {
      id: emailTransportId,
      name: 'Test Resend domains',
      type: 'RESEND',
      fromName: 'Test',
      fromAddress: `sender@${domainName}`,
      config: encryptEmailTransportConfig({ type: 'RESEND', apiKey: 'test-key-no-network' }),
    },
  });
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (!url.startsWith('https://api.resend.com/domains')) {
      return originalFetch(input, init);
    }
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-key-no-network');
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (deny) {
      return Promise.resolve(Response.json({ message: 'access denied' }, { status: 403 }));
    }
    const remote = { id: remoteId, name: domainName, status, records, capabilities: { sending: 'enabled' } };
    if (url.endsWith('/verify')) {
      status = 'verified';
      return Promise.resolve(Response.json({ object: 'domain', id: remoteId }));
    }
    if (new URL(url).searchParams.has('limit')) {
      return Promise.resolve(Response.json({ data: [remote], has_more: false }));
    }
    return Promise.resolve(Response.json(remote));
  };
  try {
    await prisma.organisationClaim.update({
      where: { id: organisation.organisationClaimId },
      data: { emailTransportId },
    });
    const created = await createEmailDomain({ organisationId: organisation.id, domain: domainName });
    expect(created.emailDomain.resendId).toBe(remoteId);
    expect(created.emailDomain.status).toBe('PENDING');
    expect(getEmailDomainRecords(created.emailDomain)).toEqual(records);
    expect((await listResendDomains(emailTransportId)).data[0].name).toBe(domainName);
    expect((await verifyEmailDomain(created.emailDomain.id, true)).isVerified).toBe(true);
    const sender = await prisma.organisationEmail.create({
      data: {
        id: `email-${randomUUID()}`,
        organisationId: organisation.id,
        emailDomainId: created.emailDomain.id,
        email: `sender@${domainName}`,
        emailName: 'Custom sender',
      },
    });
    const context = await getEmailContext({
      source: { type: 'team', teamId: team.id },
      emailType: 'RECIPIENT',
      meta: { emailId: sender.id },
    });
    expect(context.senderEmail.address).toBe(sender.email);
    expect(context.emailTransport).not.toBe(mailer);
    await deleteEmailDomain({ emailDomainId: created.emailDomain.id });
    expect(calls.some((call) => call.startsWith('DELETE'))).toBe(false);
    const imported = await saveResendEmailDomain({
      organisationId: organisation.id,
      emailTransportId,
      resendId: remoteId,
    });
    expect(imported.emailDomain.status).toBe('ACTIVE');
    await expect(
      saveResendEmailDomain({ organisationId: organisation.id, emailTransportId, resendId: remoteId }),
    ).rejects.toThrow('already attached');
    deny = true;
    await expect(requestResendDomains('test-key-no-network')).rejects.toThrow('Full access API key');
    expect(
      getEmailDomainRecords({ resendId: null, selector: 'dkim.example.com', publicKey: 'key', dnsRecords: [] })[0]
        .value,
    ).toBe('v=DKIM1; k=rsa; p=key');
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.emailDomain.deleteMany({ where: { emailTransportId } });
    await unseedUser(user.id);
    await prisma.emailTransport.delete({ where: { id: emailTransportId } });
  }
});

test('admin domain management exposes create and import with the saved Resend account', async ({ page }) => {
  const transport = await prisma.emailTransport.findFirst({ where: { type: 'RESEND' }, select: { id: true } });
  test.skip(!transport, 'Requires a configured Resend account for a read-only provider check');
  const { user, organisation } = await seedUser({ isAdmin: true });
  try {
    await apiSignin({ page, email: user.email, redirectPath: '/admin/email-domains' });
    await page.getByRole('link', { name: 'Create / import domain' }).click();
    await expect(page.getByRole('heading', { name: 'Create or import email domain' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Domains in Resend' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create domain', exact: true })).toBeDisabled();
    // The development server can display SSR controls before client hydration finishes.
    await expect(async () => {
      await page.getByRole('combobox', { name: /^Organi[sz]ation$/ }).selectOption(organisation.id);
      await expect(page.getByRole('button', { name: 'Create domain', exact: true })).toBeEnabled();
    }).toPass({ timeout: 20_000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.screenshot({ path: '../../tmp/resend-admin-domains.png', fullPage: true });
    await prisma.user.update({ where: { id: user.id }, data: { roles: ['USER'] } });
    const forbidden = await page.request.get('/admin/email-domains/new', { maxRedirects: 0 });
    expect([302, 403]).toContain(forbidden.status());
  } finally {
    await unseedUser(user.id);
  }
});

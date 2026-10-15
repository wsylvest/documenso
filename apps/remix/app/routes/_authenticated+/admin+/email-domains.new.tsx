import { getOptionalSession } from '@documenso/auth/server/lib/utils/get-session';
import { createEmailDomain } from '@documenso/ee/server-only/lib/create-email-domain';
import { saveResendEmailDomain } from '@documenso/ee/server-only/lib/save-resend-email-domain';
import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { AppError } from '@documenso/lib/errors/app-error';
import { listResendDomains } from '@documenso/lib/server-only/email/resend-domains';
import { env } from '@documenso/lib/utils/env';
import { isAdmin } from '@documenso/lib/utils/is-admin';
import { prisma } from '@documenso/prisma';
import { ZDomainSchema } from '@documenso/trpc/server/enterprise-router/create-organisation-email-domain.types';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { z } from 'zod';

import { SettingsHeader } from '~/components/general/settings-header';
import type { Route } from './+types/email-domains.new';

const assertAdmin = async (request: Request) => {
  const { user } = await getOptionalSession(request);
  if (!user || !isAdmin(user)) {
    throw data('Forbidden', { status: 403 });
  }
};
export const headers = () => ({ 'Cache-Control': 'private, no-store, no-transform' });

export async function loader({ request }: Route.LoaderArgs) {
  await assertAdmin(request);
  const params = new URL(request.url).searchParams;
  const [transports, organisations, existing] = await Promise.all([
    prisma.emailTransport.findMany({
      where: { type: 'RESEND' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.organisation.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.emailDomain.findMany({ select: { id: true, domain: true } }),
  ]);
  const systemResend = env('NEXT_PRIVATE_SMTP_TRANSPORT') === 'resend';
  const systemSes = Boolean(
    env('NEXT_PRIVATE_SES_ACCESS_KEY_ID') &&
      env('NEXT_PRIVATE_SES_SECRET_ACCESS_KEY') &&
      env('NEXT_PRIVATE_SES_REGION'),
  );
  const sources = [
    ...transports,
    ...(systemResend || systemSes ? [{ id: 'system', name: systemResend ? 'System Resend' : 'System AWS SES' }] : []),
  ];
  const transportId = params.get('transport') ?? sources[0]?.id ?? '';
  const isResend = transportId !== 'system' || systemResend;
  let remote: Awaited<ReturnType<typeof listResendDomains>> | null = null;
  let error: string | null = null;
  if (sources.some((source) => source.id === transportId) && isResend) {
    try {
      remote = await listResendDomains(transportId === 'system' ? null : transportId, params.get('after') || undefined);
    } catch (err) {
      error = AppError.parseError(err).message;
    }
  }
  return { sources, organisations, existing, transportId, isResend, remote, error };
}

export async function action({ request }: Route.ActionArgs) {
  await assertAdmin(request);
  if (request.method !== 'POST' || request.headers.get('Origin') !== new URL(NEXT_PUBLIC_WEBAPP_URL()).origin) {
    throw data('Forbidden', { status: 403 });
  }
  const base = z.object({ organisationId: z.string().min(1), transportId: z.string().min(1) });
  const parsed = z
    .discriminatedUnion('operation', [
      base.extend({ operation: z.literal('create'), domain: ZDomainSchema }),
      base.extend({ operation: z.literal('import'), resendId: z.string().uuid() }),
    ])
    .safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) {
    return data({ error: 'Select an organisation and transport, and enter a valid domain.' }, { status: 400 });
  }
  const input = parsed.data;
  const emailTransportId = input.transportId === 'system' ? null : input.transportId;
  // The posted transport must be one of the allowed provider choices, not an arbitrary SMTP transport.
  if (emailTransportId) {
    const transport = await prisma.emailTransport.findUnique({
      where: { id: emailTransportId },
      select: { type: true },
    });
    if (transport?.type !== 'RESEND') {
      return data({ error: 'Select a Resend transport.' }, { status: 400 });
    }
  }
  try {
    const result =
      input.operation === 'import'
        ? await saveResendEmailDomain({
            organisationId: input.organisationId,
            emailTransportId,
            resendId: input.resendId,
          })
        : await createEmailDomain({ organisationId: input.organisationId, emailTransportId, domain: input.domain });
    return redirect(`/admin/email-domains/${result.emailDomain.id}`);
  } catch (err) {
    return data({ error: AppError.parseError(err).message }, { status: 400 });
  }
}

export default function AdminCreateEmailDomain({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useLingui();
  const { sources, organisations, transportId, isResend, remote, existing, error } = loaderData;
  const [organisationId, setOrganisationId] = useState('');
  const navigation = useNavigation();
  const isPending = navigation.state !== 'idle';
  const selectClass = 'h-10 w-full rounded-md border bg-background px-3 text-sm';

  return (
    <div className="space-y-6">
      <SettingsHeader
        title={t`Create or import email domain`}
        subtitle={t`Choose the provider account and the organisation that will use this sending domain.`}
      />
      <Link to="/admin/email-domains" className="text-sm underline">
        <Trans>Back to email domains</Trans>
      </Link>
      {(error || actionData?.error) && (
        <p role="alert" className="rounded-md border border-destructive p-4 text-destructive">
          {actionData?.error || error}
        </p>
      )}
      {sources.length === 0 ? (
        <p>
          <Trans>
            Configure a Resend email transport in Admin → Email Transports, or configure the system Resend or AWS SES
            credentials.
          </Trans>
        </p>
      ) : (
        <>
          <Form method="get" className="space-y-2">
            <label htmlFor="domain-transport" className="font-medium text-sm">
              <Trans>Email provider account</Trans>
            </label>
            <select
              id="domain-transport"
              className={selectClass}
              name="transport"
              defaultValue={transportId}
              key={transportId}
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
            >
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" disabled={isPending}>
              <Trans>Load domains</Trans>
            </Button>
          </Form>
          <div className="space-y-2">
            <label htmlFor="domain-organisation" className="font-medium text-sm">
              <Trans>Organisation</Trans>
            </label>
            <select
              id="domain-organisation"
              className={selectClass}
              value={organisationId}
              onChange={(event) => setOrganisationId(event.target.value)}
            >
              <option value="">{t`Select an organisation`}</option>
              {organisations.map((organisation) => (
                <option key={organisation.id} value={organisation.id}>
                  {organisation.name}
                </option>
              ))}
            </select>
          </div>
          <Form method="post" className="space-y-2">
            <fieldset disabled={isPending} className="space-y-2">
              <input type="hidden" name="transportId" value={transportId} />
              <input type="hidden" name="organisationId" value={organisationId} />
              <label htmlFor="new-domain" className="font-medium text-sm">
                <Trans>New domain</Trans>
              </label>
              <Input id="new-domain" name="domain" placeholder="example.com" required />
              <Button name="operation" value="create" disabled={!organisationId}>
                <Trans>Create domain</Trans>
              </Button>
            </fieldset>
          </Form>
          {isResend && (
            <p className="text-muted-foreground text-sm">
              <Trans>
                Resend requires a Full access API key to manage domains. Importing a domain copies its DNS records and
                verification status; it does not change DNS or send email.
              </Trans>
            </p>
          )}
          {remote && (
            <section className="space-y-3">
              <h3 className="font-semibold">
                <Trans>Domains in Resend</Trans>
              </h3>
              {remote.data.length === 0 && (
                <p>
                  <Trans>No domains found in this Resend account.</Trans>
                </p>
              )}
              {remote.data.map((domain) => {
                const linked = existing.find((item) => item.domain === domain.name.toLowerCase());
                return (
                  <div
                    key={domain.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div>
                      <p className="font-medium">{domain.name}</p>
                      <p className="text-muted-foreground text-sm">{domain.status}</p>
                    </div>
                    {linked ? (
                      <Button asChild variant="outline">
                        <Link to={`/admin/email-domains/${linked.id}`}>
                          <Trans>View linked domain</Trans>
                        </Link>
                      </Button>
                    ) : (
                      <Form method="post">
                        <input type="hidden" name="organisationId" value={organisationId} />
                        <input type="hidden" name="transportId" value={transportId} />
                        <input type="hidden" name="resendId" value={domain.id} />
                        <Button name="operation" value="import" disabled={!organisationId || isPending}>
                          <Trans>Import domain</Trans>
                        </Button>
                      </Form>
                    )}
                  </div>
                );
              })}
              {remote.has_more && remote.data.length > 0 && (
                <Button asChild variant="outline">
                  <Link
                    to={`?${new URLSearchParams({ transport: transportId, after: remote.data[remote.data.length - 1].id })}`}
                  >
                    <Trans>Next domains</Trans>
                  </Link>
                </Button>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

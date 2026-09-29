import { getOptionalSession } from '@documenso/auth/server/lib/utils/get-session';
import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { AppError } from '@documenso/lib/errors/app-error';
import {
  getMailpitMessage,
  isMailpitConfigured,
  listMailpitMessages,
  updateMailpitMessage,
  ZMailpitMessageId,
} from '@documenso/lib/server-only/mailpit/client';
import { isAdmin } from '@documenso/lib/utils/is-admin';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@documenso/ui/primitives/tabs';
import { Trans, useLingui } from '@lingui/react/macro';
import { RefreshCwIcon } from 'lucide-react';
import { data, Form, Link, redirect, useNavigation, useRevalidator } from 'react-router';
import { z } from 'zod';

import { SettingsHeader } from '~/components/general/settings-header';
import type { Route } from './+types/mailpit';

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
  const query = (params.get('q') ?? '').slice(0, 500);
  const start = z.coerce
    .number()
    .int()
    .min(0)
    .max(1_000_000)
    .catch(0)
    .parse(params.get('start') ?? 0);
  const id = ZMailpitMessageId.safeParse(params.get('id'));
  const configured = isMailpitConfigured();
  let inbox: Awaited<ReturnType<typeof listMailpitMessages>> | null = null;
  let message: Awaited<ReturnType<typeof getMailpitMessage>> | null = null;
  let error: string | null = null;
  if (configured) {
    try {
      // Opening a message marks it read in Mailpit, so refresh counts afterwards.
      if (id.success) {
        message = await getMailpitMessage(id.data);
      }
      inbox = await listMailpitMessages(query, start);
    } catch (err) {
      error = AppError.parseError(err).message;
    }
  }
  return { configured, inbox, message, query, start, error };
}

export async function action({ request }: Route.ActionArgs) {
  await assertAdmin(request);
  if (request.method !== 'POST' || request.headers.get('Origin') !== new URL(NEXT_PUBLIC_WEBAPP_URL()).origin) {
    throw data('Forbidden', { status: 403 });
  }
  const input = z
    .object({
      id: ZMailpitMessageId,
      operation: z.enum(['read', 'unread', 'delete']),
    })
    .safeParse(Object.fromEntries(await request.formData()));
  if (!input.success) {
    return data({ error: 'Invalid message operation.' }, { status: 400 });
  }
  try {
    await updateMailpitMessage(input.data.id, input.data.operation);
  } catch (err) {
    return data({ error: AppError.parseError(err).message }, { status: 502 });
  }
  const params = new URL(request.url).searchParams;
  params.delete('id');
  return redirect(`/admin/mailpit?${params}`);
}

export default function AdminMailpit({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useLingui();
  const { configured, inbox, message, query, start, error } = loaderData;
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const isPending = navigation.state !== 'idle' || revalidator.state !== 'idle';
  const linkTo = (offset: number, id?: string) => {
    const params = new URLSearchParams({ q: query, start: String(offset) });
    if (id) {
      params.set('id', id);
    }
    return `/admin/mailpit?${params}${id ? '#message' : ''}`;
  };

  return (
    <div className="space-y-4">
      <SettingsHeader
        title={t`Mailpit inbox`}
        subtitle={t`Captured development emails. These messages have not been delivered to recipients.`}
      >
        <Button variant="outline" disabled={isPending || !configured} onClick={() => void revalidator.revalidate()}>
          <RefreshCwIcon className="mr-2 h-4 w-4" />
          <Trans>Refresh</Trans>
        </Button>
      </SettingsHeader>
      {!configured && (
        <p className="rounded-md border p-4">
          <Trans>Mailpit is not configured. Set NEXT_PRIVATE_MAILPIT_URL on the server and restart the app.</Trans>
        </p>
      )}
      {(error || actionData?.error) && (
        <p role="alert" className="rounded-md border border-destructive p-4 text-destructive">
          {actionData?.error || error}
        </p>
      )}
      {configured && (
        <Form method="get" className="flex gap-2">
          <Input
            key={query}
            name="q"
            defaultValue={query}
            aria-label={t`Search emails`}
            placeholder={t`Search subject, address or message text`}
          />
          <Button type="submit" disabled={isPending}>
            <Trans>Search</Trans>
          </Button>
        </Form>
      )}
      {inbox && (
        <>
          <p className="text-muted-foreground text-sm">
            <Trans>
              {inbox.total} captured · {inbox.unread} unread · {inbox.messages_count} matching
            </Trans>
          </p>
          <div className="divide-y rounded-md border">
            {inbox.messages.length === 0 && (
              <p className="p-6 text-muted-foreground">
                <Trans>No messages found.</Trans>
              </p>
            )}
            {inbox.messages.map((item) => (
              <Link
                key={item.ID}
                to={linkTo(start, item.ID)}
                className={`block p-4 hover:bg-muted ${message?.ID === item.ID ? 'bg-muted' : ''}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={item.Read ? '' : 'font-semibold'}>{item.Subject || t`(No subject)`}</span>
                  <span className="text-muted-foreground text-xs">{new Date(item.Created).toUTCString()}</span>
                </div>
                <p className="truncate text-muted-foreground text-sm">
                  {item.From.Address} → {item.To.map((address) => address.Address).join(', ')}
                </p>
                <p className="truncate text-muted-foreground text-sm">{item.Snippet}</p>
                {!item.Read && (
                  <span className="text-xs">
                    <Trans>Unread</Trans>
                  </span>
                )}
              </Link>
            ))}
          </div>
          <div className="flex justify-between">
            <Button variant="outline" disabled={start === 0 || isPending} asChild={start > 0}>
              {start > 0 ? (
                <Link to={linkTo(Math.max(0, start - 25))}>
                  <Trans>Previous</Trans>
                </Link>
              ) : (
                <span>
                  <Trans>Previous</Trans>
                </span>
              )}
            </Button>
            {start + 25 < inbox.messages_count && (
              <Button variant="outline" asChild>
                <Link to={linkTo(start + 25)}>
                  <Trans>Next</Trans>
                </Link>
              </Button>
            )}
          </div>
        </>
      )}
      {message && (
        <section id="message" className="space-y-4 rounded-md border p-4" aria-label={t`Message details`}>
          <h3 className="break-words font-semibold text-lg">{message.Subject || t`(No subject)`}</h3>
          <dl className="space-y-1 break-words text-sm">
            <div>
              <dt className="inline font-medium">
                <Trans>From</Trans>:{' '}
              </dt>
              <dd className="inline">
                {message.From.Name} &lt;{message.From.Address}&gt;
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">
                <Trans>To</Trans>:{' '}
              </dt>
              <dd className="inline">{message.To.map((address) => address.Address).join(', ')}</dd>
            </div>
            {message.Cc.length > 0 && <div>CC: {message.Cc.map((address) => address.Address).join(', ')}</div>}
            {message.Bcc.length > 0 && <div>BCC: {message.Bcc.map((address) => address.Address).join(', ')}</div>}
            <div>
              <dt className="inline font-medium">
                <Trans>Date</Trans>:{' '}
              </dt>
              <dd className="inline">{new Date(message.Date).toUTCString()}</dd>
            </div>
            <div>
              <dt className="inline font-medium">
                <Trans>Message ID</Trans>:{' '}
              </dt>
              <dd className="inline">{message.MessageID}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Form method="post">
              <input type="hidden" name="id" value={message.ID} />
              <Button variant="outline" name="operation" value="unread" disabled={isPending}>
                <Trans>Mark unread</Trans>
              </Button>
            </Form>
            <Form
              method="post"
              onSubmit={(event) => {
                if (!window.confirm(t`Permanently delete this captured email?`)) {
                  event.preventDefault();
                }
              }}
            >
              <input type="hidden" name="id" value={message.ID} />
              <Button variant="destructive" name="operation" value="delete" disabled={isPending}>
                <Trans>Delete message</Trans>
              </Button>
            </Form>
          </div>
          <Tabs defaultValue="text" key={message.ID}>
            <TabsList>
              <TabsTrigger value="text">
                <Trans>Plain text</Trans>
              </TabsTrigger>
              <TabsTrigger value="html">
                <Trans>HTML preview</Trans>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="text">
              <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap break-words text-sm">
                {message.Text || t`No plain text body.`}
              </pre>
            </TabsContent>
            <TabsContent value="html">
              <p className="mb-2 text-muted-foreground text-xs">
                <Trans>Scripts, forms and remote images are blocked in this preview.</Trans>
              </p>
              <iframe
                title={t`Email HTML preview`}
                sandbox=""
                referrerPolicy="no-referrer"
                className="h-[36rem] w-full rounded-md border bg-white"
                srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'">${message.HTML}`}
              />
            </TabsContent>
          </Tabs>
          {message.Attachments.length > 0 && (
            <div>
              <h4 className="font-medium">
                <Trans>Attachments</Trans>
              </h4>
              <ul>
                {message.Attachments.map((attachment, index) => (
                  <li key={`${attachment.FileName}-${index}`}>
                    {attachment.FileName} ({attachment.Size} bytes)
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

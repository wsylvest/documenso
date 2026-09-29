import { z } from 'zod';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { env } from '../../utils/env';

const ZAddress = z.object({ Name: z.string(), Address: z.string() });
const ZAddresses = z
  .array(ZAddress)
  .nullish()
  .transform((value) => value ?? []);
const ZMessageSummary = z.object({
  ID: z.string(),
  Read: z.boolean(),
  From: ZAddress,
  To: ZAddresses,
  Subject: z.string(),
  Created: z.string(),
  Snippet: z.string(),
});
const ZInbox = z.object({
  messages: z
    .array(ZMessageSummary)
    .nullish()
    .transform((value) => value ?? []),
  messages_count: z.number(),
  total: z.number(),
  unread: z.number(),
});
const ZMessage = z.object({
  ID: z.string(),
  MessageID: z.string(),
  From: ZAddress,
  To: ZAddresses,
  Cc: ZAddresses,
  Bcc: ZAddresses,
  Subject: z.string(),
  Date: z.string(),
  Text: z.string(),
  HTML: z.string(),
  Attachments: z
    .array(z.object({ FileName: z.string(), Size: z.number() }))
    .nullish()
    .transform((value) => value ?? []),
});

export const ZMailpitMessageId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9-]+$/);
export const isMailpitConfigured = () => Boolean(env('NEXT_PRIVATE_MAILPIT_URL'));

const requestMailpit = async (path: string, init?: RequestInit) => {
  const baseUrl = env('NEXT_PRIVATE_MAILPIT_URL');
  if (!baseUrl) {
    throw new AppError(AppErrorCode.NOT_SETUP, { message: 'Mailpit is not configured.' });
  }

  try {
    const url = new URL(`${baseUrl.replace(/\/$/, '')}/api/v1/${path}`);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new AppError(AppErrorCode.NOT_SETUP);
    }
    const response = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (response.status === 404) {
      throw new AppError(AppErrorCode.NOT_FOUND, { message: 'The message is no longer available.' });
    }
    if (!response.ok) {
      throw new AppError(AppErrorCode.UNKNOWN_ERROR);
    }
    return response;
  } catch (error) {
    if (error instanceof AppError && error.code === AppErrorCode.NOT_FOUND) {
      throw error;
    }
    throw new AppError(AppErrorCode.UNKNOWN_ERROR, {
      message: 'Cannot connect to Mailpit. Check that the service is running and its server URL is correct.',
    });
  }
};

export const listMailpitMessages = async (query: string, start: number) => {
  const params = new URLSearchParams({ start: String(start), limit: '25' });
  if (query) {
    params.set('query', query);
  }
  const response = await requestMailpit(`${query ? 'search' : 'messages'}?${params}`);
  return ZInbox.parse(await response.json());
};

export const getMailpitMessage = async (id: string) => {
  const response = await requestMailpit(`message/${ZMailpitMessageId.parse(id)}`);
  return ZMessage.parse(await response.json());
};

export const updateMailpitMessage = async (id: string, operation: 'read' | 'unread' | 'delete') => {
  // Never send an empty IDs array: Mailpit treats it as an operation on the entire inbox.
  const ids = [ZMailpitMessageId.parse(id)];
  await requestMailpit('messages', {
    method: operation === 'delete' ? 'DELETE' : 'PUT',
    body: JSON.stringify(operation === 'delete' ? { ids } : { ids, read: operation === 'read' }),
  });
};

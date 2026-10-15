import { prisma } from '@documenso/prisma';
import { z } from 'zod';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { env } from '../../utils/env';
import { decryptEmailTransportConfig } from './email-transport-config';

const ZDomainSummary = z.object({ id: z.string().uuid(), name: z.string(), status: z.string() });
export const ZResendDomain = ZDomainSummary.extend({
  capabilities: z.object({ sending: z.string() }).optional(),
  records: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      type: z.string(),
      priority: z.number().optional(),
      ttl: z.string().optional(),
      status: z.string().optional(),
    }),
  ),
});
export type ResendDomain = z.infer<typeof ZResendDomain>;

export const getResendApiKey = async (emailTransportId: string | null) => {
  if (emailTransportId) {
    const transport = await prisma.emailTransport.findUniqueOrThrow({ where: { id: emailTransportId } });
    const config = decryptEmailTransportConfig(transport.config);
    if (config.type !== 'RESEND') {
      throw new AppError(AppErrorCode.NOT_SETUP, { message: 'Select a Resend email transport.' });
    }
    return config.apiKey;
  }
  const key = env('NEXT_PRIVATE_RESEND_API_KEY');
  if (!key || env('NEXT_PRIVATE_SMTP_TRANSPORT') !== 'resend') {
    throw new AppError(AppErrorCode.NOT_SETUP, { message: 'The system Resend transport is not configured.' });
  }
  return key;
};

export const requestResendDomains = async (apiKey: string, path = '', init?: RequestInit): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetch(`https://api.resend.com/domains${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
  } catch {
    throw new AppError(AppErrorCode.UNKNOWN_ERROR, { message: 'Could not reach Resend. Please try again.' });
  }
  if (!response.ok) {
    const message =
      response.status === 401 || response.status === 403
        ? 'Resend denied access. Domain management requires a valid Full access API key on this transport.'
        : response.status === 429
          ? 'Resend rate limit reached. Wait a moment and try again.'
          : response.status === 404
            ? 'This domain no longer exists in Resend.'
            : 'Resend could not process the domain request. Check for an existing domain or an account domain limit.';
    throw new AppError(response.status === 404 ? AppErrorCode.NOT_FOUND : AppErrorCode.INVALID_REQUEST, { message });
  }
  return await response.json();
};

export const listResendDomains = async (emailTransportId: string | null, after?: string) => {
  const key = await getResendApiKey(emailTransportId);
  const params = new URLSearchParams({ limit: '100' });
  if (after) {
    params.set('after', z.string().uuid().parse(after));
  }
  return z
    .object({ data: z.array(ZDomainSummary), has_more: z.boolean() })
    .parse(await requestResendDomains(key, `?${params}`));
};

export const getResendDomain = async (emailTransportId: string | null, id: string) => {
  return ZResendDomain.parse(
    await requestResendDomains(await getResendApiKey(emailTransportId), `/${z.string().uuid().parse(id)}`),
  );
};

export const isResendDomainVerified = (domain: ResendDomain) =>
  domain.status === 'verified' && domain.capabilities?.sending !== 'disabled';

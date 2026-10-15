import { z } from 'zod';

import type { TrpcRouteMeta } from '../trpc';
import { ZSigningTokenSchema } from './schema';

export const requestSigningAccessCodeMeta: TrpcRouteMeta = {
  openapi: {
    method: 'POST',
    path: '/signing/access-code/request',
    summary: 'Request signing access code',
    description:
      'Emails a one-time access code to the recipient for envelopes that require two factor access authentication. Pass the code back as accessAuthOptions when completing signing. Fails when the envelope does not require two factor access.',
    tags: ['Signing'],
  },
};

export const ZRequestSigningAccessCodeRequestSchema = z.object({
  token: ZSigningTokenSchema,
});

export const ZRequestSigningAccessCodeResponseSchema = z.object({
  success: z.literal(true),
  expiresAt: z.date().describe('When the emailed code stops being valid.'),
});

export type TRequestSigningAccessCodeRequest = z.infer<typeof ZRequestSigningAccessCodeRequestSchema>;
export type TRequestSigningAccessCodeResponse = z.infer<typeof ZRequestSigningAccessCodeResponseSchema>;

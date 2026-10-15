import { ZEnvelopeSigningStatusSchema } from '@documenso/lib/server-only/envelope/get-envelope-signing-status';
import { z } from 'zod';

import type { TrpcRouteMeta } from '../trpc';
import { ZSigningTokenSchema } from './schema';

export const getSigningStatusMeta: TrpcRouteMeta = {
  openapi: {
    method: 'GET',
    path: '/signing/status',
    summary: 'Get signing status',
    description:
      'Returns the overall signing state of the envelope the token belongs to. PROCESSING means all recipients have finished and the document is being sealed.',
    tags: ['Signing'],
  },
};

export const ZGetSigningStatusRequestSchema = z.object({
  token: ZSigningTokenSchema,
});

export const ZGetSigningStatusResponseSchema = z.object({
  status: ZEnvelopeSigningStatusSchema.describe('The current signing status of the envelope'),
});

export type TGetSigningStatusRequest = z.infer<typeof ZGetSigningStatusRequestSchema>;
export type TGetSigningStatusResponse = z.infer<typeof ZGetSigningStatusResponseSchema>;

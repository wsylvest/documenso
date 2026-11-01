import { ZEnvelopeForSigningResponse } from '@documenso/lib/server-only/envelope/get-envelope-for-recipient-signing';
import { z } from 'zod';

import type { TrpcRouteMeta } from '../trpc';
import { ZSigningTokenSchema } from './schema';

export const getSigningEnvelopeMeta: TrpcRouteMeta = {
  openapi: {
    method: 'GET',
    path: '/signing/envelope',
    summary: 'Get signing envelope',
    description:
      'Returns everything a signing experience needs for the recipient identified by the token: the envelope, its items with download URLs, the recipient and their fields, the other recipients, turn order and signing options. Use this to render a native signing UI in your own application instead of embedding the SR Sign signing page.',
    tags: ['Signing'],
  },
};

export const ZGetSigningEnvelopeRequestSchema = z.object({
  token: ZSigningTokenSchema,
});

export const ZGetSigningEnvelopeResponseSchema = ZEnvelopeForSigningResponse.extend({
  files: z
    .array(
      z.object({
        envelopeItemId: z.string(),
        url: z
          .string()
          .describe(
            'URL that serves the current PDF for this envelope item. The URL is authorised by the signing token and does not require an API key.',
          ),
      }),
    )
    .describe('Download URLs for each envelope item, in envelope item order.'),
});

export type TGetSigningEnvelopeRequest = z.infer<typeof ZGetSigningEnvelopeRequestSchema>;
export type TGetSigningEnvelopeResponse = z.infer<typeof ZGetSigningEnvelopeResponseSchema>;

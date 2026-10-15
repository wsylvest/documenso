import { z } from 'zod';

import type { TrpcRouteMeta } from '../trpc';
import { ZSignerMetadataHeadersSchema, ZSignerMetadataSchema, ZSigningTokenSchema } from './schema';

export const viewSigningEnvelopeMeta: TrpcRouteMeta = {
  openapi: {
    method: 'POST',
    path: '/signing/view',
    summary: 'Record signing envelope viewed',
    description:
      'Records that the recipient has opened the document. Writes the DOCUMENT_VIEWED audit entry, marks the recipient as opened on first view and fires the DOCUMENT_OPENED webhook. Call this when your native signing UI first displays the document to the signer.',
    tags: ['Signing'],
    requestHeaders: ZSignerMetadataHeadersSchema,
  },
};

export const ZViewSigningEnvelopeRequestSchema = z.object({
  token: ZSigningTokenSchema,
  signer: ZSignerMetadataSchema.optional(),
});

export const ZViewSigningEnvelopeResponseSchema = z.object({
  success: z.literal(true),
});

export type TViewSigningEnvelopeRequest = z.infer<typeof ZViewSigningEnvelopeRequestSchema>;
export type TViewSigningEnvelopeResponse = z.infer<typeof ZViewSigningEnvelopeResponseSchema>;

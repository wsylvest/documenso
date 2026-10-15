import { ZRecipientAccessAuthSchema } from '@documenso/lib/types/document-auth';
import { z } from 'zod';

import type { TrpcRouteMeta } from '../trpc';
import { ZSignerMetadataHeadersSchema, ZSignerMetadataSchema, ZSigningTokenSchema } from './schema';

export const rejectSigningMeta: TrpcRouteMeta = {
  openapi: {
    method: 'POST',
    path: '/signing/reject',
    summary: 'Reject signing',
    description:
      'Rejects the document on behalf of the recipient identified by the token. Requires the same access authentication proof as completing. The envelope moves to REJECTED, the owner is notified and the DOCUMENT_REJECTED webhook fires.',
    tags: ['Signing'],
    requestHeaders: ZSignerMetadataHeadersSchema,
  },
};

export const ZRejectSigningRequestSchema = z.object({
  token: ZSigningTokenSchema,
  reason: z.string().trim().min(1).max(5000).describe('The reason the recipient gave for rejecting the document.'),
  accessAuthOptions: ZRecipientAccessAuthSchema.optional().describe(
    'Access authentication proof, such as the two factor code emailed to the recipient, for envelopes that require it.',
  ),
  signer: ZSignerMetadataSchema.optional(),
});

export const ZRejectSigningResponseSchema = z.object({
  success: z.literal(true),
});

export type TRejectSigningRequest = z.infer<typeof ZRejectSigningRequestSchema>;
export type TRejectSigningResponse = z.infer<typeof ZRejectSigningResponseSchema>;

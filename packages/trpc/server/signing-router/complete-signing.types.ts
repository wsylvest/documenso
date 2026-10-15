import { ZRecipientAccessAuthSchema } from '@documenso/lib/types/document-auth';
import { zEmail } from '@documenso/lib/utils/zod';
import { z } from 'zod';

import type { TrpcRouteMeta } from '../trpc';
import { ZSignerMetadataHeadersSchema, ZSignerMetadataSchema, ZSigningTokenSchema } from './schema';

export const completeSigningMeta: TrpcRouteMeta = {
  openapi: {
    method: 'POST',
    path: '/signing/complete',
    summary: 'Complete signing',
    description:
      'Finalises signing for the recipient. Every required field must already be inserted. Returns SIGNED when the recipient is done, ALREADY_SIGNED when a retried request finds the recipient had already completed, or REDIRECT with a URL when the envelope uses an AES or QES signature level and the signer must finish with the trust service provider.',
    tags: ['Signing'],
    requestHeaders: ZSignerMetadataHeadersSchema,
  },
};

export const ZCompleteSigningRequestSchema = z.object({
  token: ZSigningTokenSchema,
  accessAuthOptions: ZRecipientAccessAuthSchema.optional().describe(
    'Access authentication proof, such as the two factor code emailed to the recipient, for envelopes that require it.',
  ),
  nextSigner: z
    .object({
      email: zEmail().max(254),
      name: z.string().min(1).max(255),
    })
    .optional()
    .describe(
      'Override the next recipient in a sequential flow. Only allowed when the envelope permits dictating the next signer.',
    ),
  recipientOverride: z
    .object({
      email: zEmail().trim().toLowerCase().max(254).optional(),
      name: z.string().max(255).optional(),
    })
    .optional()
    .describe("Update the signing recipient's own name or email at completion time."),
  signer: ZSignerMetadataSchema.optional(),
});

export const ZCompleteSigningResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('SIGNED') }),
  z.object({ status: z.literal('ALREADY_SIGNED') }),
  z.object({ status: z.literal('REDIRECT'), redirectUrl: z.string() }),
]);

export type TCompleteSigningRequest = z.infer<typeof ZCompleteSigningRequestSchema>;
export type TCompleteSigningResponse = z.infer<typeof ZCompleteSigningResponseSchema>;

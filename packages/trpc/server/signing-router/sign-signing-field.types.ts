import { ZRecipientActionAuthSchema } from '@documenso/lib/types/document-auth';
import { z } from 'zod';

import {
  ZSignEnvelopeFieldResponseSchema,
  ZSignEnvelopeFieldValue,
} from '../envelope-router/sign-envelope-field.types';
import type { TrpcRouteMeta } from '../trpc';
import { ZSignerMetadataHeadersSchema, ZSignerMetadataSchema, ZSigningTokenSchema } from './schema';

export const signSigningFieldMeta: TrpcRouteMeta = {
  openapi: {
    method: 'POST',
    path: '/signing/field/sign',
    summary: 'Sign field',
    description:
      "Inserts or clears a value for one of the recipient's fields. For SIGNATURE fields pass a typed name or a base64 data URL of the drawn signature image. Pass a null value to clear a field. Fields protected by action authentication require the matching authOptions. Signing is not final until the complete endpoint is called.",
    tags: ['Signing'],
    requestHeaders: ZSignerMetadataHeadersSchema,
  },
};

export const ZSignSigningFieldRequestSchema = z.object({
  token: ZSigningTokenSchema,
  fieldId: z
    .number()
    .describe('The ID of the field to sign. Field IDs are returned by the get signing envelope endpoint.'),
  fieldValue: ZSignEnvelopeFieldValue,
  authOptions: ZRecipientActionAuthSchema.optional().describe(
    'Authentication proof for fields protected by action auth, such as a two factor code or password.',
  ),
  signer: ZSignerMetadataSchema.optional(),
});

export const ZSignSigningFieldResponseSchema = ZSignEnvelopeFieldResponseSchema;

export type TSignSigningFieldRequest = z.infer<typeof ZSignSigningFieldRequestSchema>;
export type TSignSigningFieldResponse = z.infer<typeof ZSignSigningFieldResponseSchema>;

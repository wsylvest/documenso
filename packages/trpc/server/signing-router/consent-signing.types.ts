import { z } from 'zod';

import type { TrpcRouteMeta } from '../trpc';
import { ZSignerMetadataHeadersSchema, ZSignerMetadataSchema, ZSigningTokenSchema } from './schema';

export const consentSigningMeta: TrpcRouteMeta = {
  openapi: {
    method: 'POST',
    path: '/signing/consent',
    summary: 'Record electronic signing consent',
    description:
      "Records the recipient's affirmative consent to conduct this transaction electronically, as required for consumer transactions under ESIGN. Call this after the signer has been shown the consumer disclosure (hardware and software requirements, electronic delivery, how to withdraw consent and how to obtain a paper copy) and has actively agreed, for example by ticking a checkbox. Field signing and completion are refused with ELECTRONIC_CONSENT_REQUIRED until consent is on record. Idempotent.",
    tags: ['Signing'],
    requestHeaders: ZSignerMetadataHeadersSchema,
  },
};

export const ZConsentSigningRequestSchema = z.object({
  token: ZSigningTokenSchema,
  signer: ZSignerMetadataSchema.optional(),
});

export const ZConsentSigningResponseSchema = z.object({
  electronicConsentAt: z.date().describe('When consent was recorded. Unchanged on repeat calls.'),
});

export type TConsentSigningRequest = z.infer<typeof ZConsentSigningRequestSchema>;
export type TConsentSigningResponse = z.infer<typeof ZConsentSigningResponseSchema>;

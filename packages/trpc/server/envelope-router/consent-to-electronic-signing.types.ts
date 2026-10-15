import { z } from 'zod';

export const ZConsentToElectronicSigningRequestSchema = z.object({
  token: z.string().min(1),
});

export const ZConsentToElectronicSigningResponseSchema = z.object({
  electronicConsentAt: z.date(),
});

export type TConsentToElectronicSigningRequest = z.infer<typeof ZConsentToElectronicSigningRequestSchema>;
export type TConsentToElectronicSigningResponse = z.infer<typeof ZConsentToElectronicSigningResponseSchema>;

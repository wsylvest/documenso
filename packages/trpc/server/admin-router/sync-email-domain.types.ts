import { z } from 'zod';

export const ZSyncEmailDomainRequestSchema = z.object({ emailDomainId: z.string() });
export const ZSyncEmailDomainResponseSchema = z.object({ isVerified: z.boolean() });

import { verifyEmailDomain } from '@documenso/ee/server-only/lib/verify-email-domain';

import { adminProcedure } from '../trpc';
import { ZSyncEmailDomainRequestSchema, ZSyncEmailDomainResponseSchema } from './sync-email-domain.types';

export const syncEmailDomainRoute = adminProcedure
  .input(ZSyncEmailDomainRequestSchema)
  .output(ZSyncEmailDomainResponseSchema)
  .mutation(async ({ input }) => {
    const { emailDomainId } = input;
    const { isVerified } = await verifyEmailDomain(emailDomainId);
    return { isVerified };
  });

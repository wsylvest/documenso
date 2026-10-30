import { createEmailDomain } from '@documenso/ee/server-only/lib/create-email-domain';
import { ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP } from '@documenso/lib/constants/organisations';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { isClaimFlagEnabled } from '@documenso/lib/utils/claim-flags';
import { isAdmin } from '@documenso/lib/utils/is-admin';
import { buildOrganisationWhereQuery } from '@documenso/lib/utils/organisations';
import { prisma } from '@documenso/prisma';

import { authenticatedProcedure } from '../trpc';
import {
  ZCreateOrganisationEmailDomainRequestSchema,
  ZCreateOrganisationEmailDomainResponseSchema,
} from './create-organisation-email-domain.types';

export const createOrganisationEmailDomainRoute = authenticatedProcedure
  .input(ZCreateOrganisationEmailDomainRequestSchema)
  .output(ZCreateOrganisationEmailDomainResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { organisationId, domain } = input;
    const { user } = ctx;

    ctx.logger.info({
      input: {
        organisationId,
        domain,
      },
    });

    const organisation = await prisma.organisation.findFirst({
      where: buildOrganisationWhereQuery({
        organisationId,
        userId: user.id,
        roles: ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP['MANAGE_ORGANISATION'],
      }),
      include: {
        emailDomains: true,
        organisationClaim: true,
      },
    });

    if (!organisation) {
      throw new AppError(AppErrorCode.UNAUTHORIZED);
    }

    if (!isClaimFlagEnabled(organisation.organisationClaim.flags, 'emailDomains')) {
      throw new AppError(AppErrorCode.INVALID_BODY, {
        message: 'Email domains are not enabled for this organisation',
      });
    }

    if (organisation.emailDomains.length >= 100) {
      throw new AppError(AppErrorCode.INVALID_BODY, {
        message: 'You have reached the maximum number of email domains',
      });
    }

    try {
      return await createEmailDomain({
        domain,
        organisationId,
      });
    } catch (err) {
      const error = AppError.parseError(err);

      // The NOT_SETUP message names instance configuration (env vars). Only
      // instance admins should see that detail; organisation managers get a
      // generic message instead.
      const fullUser =
        error.code === AppErrorCode.NOT_SETUP
          ? await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { roles: true } })
          : null;

      if (fullUser && !isAdmin(fullUser)) {
        throw new AppError(AppErrorCode.NOT_SETUP, {
          message: error.message,
          userMessage: 'Email sending is not set up on this instance yet. Please contact your system administrator.',
        });
      }

      throw err;
    }
  });

import { jobsClient } from '@documenso/lib/jobs/client';
import { createAdminUser } from '@documenso/lib/server-only/user/create-admin-user';

import { adminProcedure } from '../trpc';
import { ZCreateUserRequestSchema, ZCreateUserResponseSchema } from './create-user.types';

export const createUserRoute = adminProcedure
  .input(ZCreateUserRequestSchema)
  .output(ZCreateUserResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { email, name, password } = input;

    const user = await createAdminUser({
      name,
      email,
      password,
    });

    ctx.logger.info({
      createdUserId: user.id,
      passwordProvided: Boolean(password),
    });

    // An admin-supplied password is handed over out of band, so skip the welcome email.
    if (password) {
      return {
        userId: user.id,
      };
    }

    await jobsClient.triggerJob({
      name: 'send.admin.user.created.email',
      payload: {
        userId: user.id,
      },
    });

    return {
      userId: user.id,
    };
  });

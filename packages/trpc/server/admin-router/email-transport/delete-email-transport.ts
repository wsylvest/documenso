import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { prisma } from '@documenso/prisma';

import { adminProcedure } from '../../trpc';
import {
  ZDeleteEmailTransportRequestSchema,
  ZDeleteEmailTransportResponseSchema,
} from './delete-email-transport.types';

export const deleteEmailTransportRoute = adminProcedure
  .input(ZDeleteEmailTransportRequestSchema)
  .output(ZDeleteEmailTransportResponseSchema)
  .mutation(async ({ input, ctx }) => {
    ctx.logger.info({
      input: {
        id: input.id,
      },
    });

    if (await prisma.emailDomain.count({ where: { emailTransportId: input.id } })) {
      throw new AppError(AppErrorCode.INVALID_REQUEST, {
        message: 'Remove the linked email domains before deleting this transport.',
      });
    }

    await prisma.emailTransport.delete({
      where: {
        id: input.id,
      },
    });
  });

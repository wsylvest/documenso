import { prisma } from '@documenso/prisma';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { hashSync } from '../auth/hash';

export interface CreateAdminUserOptions {
  name: string;
  email: string;
  /** Optional initial password. When omitted the user must set one via a reset link. */
  password?: string;
}

/**
 * Create a user for admin-initiated flows.
 *
 * Unlike normal signup, this function:
 * - Leaves the password unset (`null`) unless one is supplied; without one the user must set it via a password reset/onboarding link
 * - Marks the email as verified immediately because this route is only called by admins
 * - Does NOT create a personal organisation (user will be added to real org)
 * - Returns the user immediately without side effects
 */
export const createAdminUser = async ({ name, email, password }: CreateAdminUserOptions) => {
  const userExists = await prisma.user.findFirst({
    where: {
      email: email.toLowerCase(),
    },
  });

  if (userExists) {
    throw new AppError(AppErrorCode.ALREADY_EXISTS, {
      message: 'User with this email already exists',
    });
  }

  const user = await prisma.user.create({
    data: {
      name,
      email: email.toLowerCase(),
      password: password ? hashSync(password) : null,
      // Verifying the email here instead of the password reset flow to reduce the
      // attack surface. This route is only called by admins.
      emailVerified: new Date(),
    },
  });

  return user;
};

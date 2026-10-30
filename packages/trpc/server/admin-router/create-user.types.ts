import { ZNameSchema } from '@documenso/lib/types/name';
import { z } from 'zod';

import { ZPasswordSchema } from '../auth-router/schema';

export const ZCreateUserRequestSchema = z.object({
  email: z.string().email().min(1),
  name: ZNameSchema,
  /**
   * When set, the user is created with this password and no welcome email is
   * sent, so an admin can hand the credentials over directly.
   */
  password: ZPasswordSchema.optional(),
});

export type TCreateUserRequest = z.infer<typeof ZCreateUserRequestSchema>;

export const ZCreateUserResponseSchema = z.object({
  userId: z.number(),
});

export type TCreateUserResponse = z.infer<typeof ZCreateUserResponseSchema>;

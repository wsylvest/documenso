import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { getTenantStatus, provisionTenant } from '@documenso/lib/server-only/provisioning/provision-tenant';
import {
  isProvisioningSecretValid,
  parseBearer,
  parseProvisioningSecrets,
  ZProvisionTenantRequestSchema,
  ZTenantSlugSchema,
} from '@documenso/lib/server-only/provisioning/provision-tenant.types';
import { env } from '@documenso/lib/utils/env';
import { Hono } from 'hono';

import type { HonoEnv } from '../../router';

/**
 * Tenant provisioning (SmartRoofing AI fork, not upstream).
 *
 * Authenticated by NEXT_PRIVATE_PROVISIONING_SECRET, a platform secret that is
 * not a team API token. With the variable unset or holding no value of 32+
 * characters the routes answer 404, as if they did not exist. During a rotation
 * it may hold the old and the new secret, comma separated; both are accepted. The caller never gets a
 * reason for a 401, and no response carries the secret or an existing token.
 */
export const provisioningRoute = new Hono<HonoEnv>()
  .use('*', async (c, next) => {
    const configured = env('NEXT_PRIVATE_PROVISIONING_SECRET');

    if (parseProvisioningSecrets(configured).length === 0) {
      return c.json({ error: 'Not found' }, 404);
    }

    if (!isProvisioningSecretValid(configured, parseBearer(c.req.header('authorization')))) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    await next();
  })
  .post('/tenants', async (c) => {
    const parsed = ZProvisionTenantRequestSchema.safeParse(await c.req.json().catch(() => null));

    if (!parsed.success) {
      return c.json({ error: 'Invalid request', issues: parsed.error.issues.map((i) => i.path.join('.')) }, 400);
    }

    try {
      const result = await provisionTenant(parsed.data);

      c.get('logger').info({
        msg: 'tenant provisioned',
        slug: parsed.data.slug,
        created: result.created,
        tokenIssued: result.apiToken !== null,
      });

      c.header('Cache-Control', 'no-store');

      return c.json(result, result.created ? 201 : 200);
    } catch (err) {
      return appErrorResponse(c, err);
    }
  })
  .get('/tenants/:slug', async (c) => {
    const slug = ZTenantSlugSchema.safeParse(c.req.param('slug'));

    if (!slug.success) {
      return c.json({ error: 'Invalid request' }, 400);
    }

    const status = await getTenantStatus(slug.data);

    return status ? c.json(status) : c.json({ error: 'Not found' }, 404);
  });

const appErrorResponse = (c: { json: (body: unknown, status: 400 | 404 | 409 | 500) => Response }, err: unknown) => {
  if (err instanceof AppError) {
    if (err.code === AppErrorCode.ALREADY_EXISTS) {
      return c.json({ error: err.message }, 409);
    }

    if (err.code === AppErrorCode.WEBHOOK_INVALID_REQUEST || err.code === AppErrorCode.INVALID_REQUEST) {
      return c.json({ error: err.message }, 400);
    }
  }

  // Anything else is ours to read in the logs; the caller gets no detail.
  console.error('tenant provisioning failed', err);

  return c.json({ error: 'Provisioning failed' }, 500);
};

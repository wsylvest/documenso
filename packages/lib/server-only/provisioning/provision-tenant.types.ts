import { createHash, timingSafeEqual } from 'node:crypto';
import { WebhookTriggerEvents } from '@prisma/client';
import { z } from 'zod';

/**
 * Tenant provisioning for SmartRoofing AI (one organisation, one team and one
 * team API token per company). Not an upstream Documenso feature.
 */

export const TENANT_API_TOKEN_NAME = 'smartroofing-estimator';

/** The events the estimator reads completion from. Anything else is noise. */
export const DEFAULT_TENANT_WEBHOOK_EVENTS = [
  WebhookTriggerEvents.DOCUMENT_COMPLETED,
  WebhookTriggerEvents.DOCUMENT_REJECTED,
  WebhookTriggerEvents.DOCUMENT_CANCELLED,
  WebhookTriggerEvents.RECIPIENT_EXPIRED,
];

/** Lowercase letters, digits and single hyphens: it becomes the org and team URL. */
export const ZTenantSlugSchema = z
  .string()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, digits and single hyphens.');

export const ZProvisionTenantRequestSchema = z.object({
  slug: ZTenantSlugSchema,
  name: z.string().trim().min(1).max(120),
  webhookUrl: z.string().url().max(500),
  /** Documenso signs each webhook with this; the estimator checks it. */
  webhookSecret: z.string().min(32).max(200),
  webhookEvents: z.array(z.nativeEnum(WebhookTriggerEvents)).min(1).optional(),
  /** Issue a new token and revoke the old one (a lost token cannot be read back). */
  rotateToken: z.boolean().default(false),
  /** Applied only when the organisation is created; later edits are the admin's. */
  settings: z
    .object({
      brandingUrl: z.string().url().max(300).optional(),
      brandingCompanyDetails: z.string().max(1000).optional(),
      emailReplyTo: z.string().email().max(200).optional(),
    })
    .optional(),
});

export type TProvisionTenantRequest = z.infer<typeof ZProvisionTenantRequestSchema>;

export type TProvisionTenantResult = {
  organisationId: string;
  organisationUrl: string;
  teamId: number;
  teamUrl: string;
  webhookId: string;
  /** True when this call created the organisation. */
  created: boolean;
  /** Returned exactly once, on the call that issued it. Null otherwise. */
  apiToken: string | null;
};

export type TTenantStatus = {
  organisationId: string;
  teamId: number;
  webhook: { id: string; enabled: boolean; events: WebhookTriggerEvents[] } | null;
  apiTokens: { name: string; createdAt: Date; lastUsedAt: Date | null }[];
};

export const MIN_PROVISIONING_SECRET_LENGTH = 32;

/**
 * The configured secrets: NEXT_PRIVATE_PROVISIONING_SECRET holds one, or two
 * separated by a comma while it is being rotated (the old and the new are both
 * accepted until every caller has the new one). Entries shorter than the
 * minimum are ignored, so a typo cannot switch the route on with a weak value.
 */
export const parseProvisioningSecrets = (configured: string | undefined) =>
  (configured ?? '')
    .split(',')
    .map((secret) => secret.trim())
    .filter((secret) => secret.length >= MIN_PROVISIONING_SECRET_LENGTH)
    .slice(0, 2);

/** Constant-time compare of the presented secret against each configured one. */
export const isProvisioningSecretValid = (configured: string | undefined, presented: string | undefined) => {
  const secrets = parseProvisioningSecrets(configured);

  if (secrets.length === 0 || !presented) {
    return false;
  }

  const digest = (value: string) => createHash('sha256').update(value).digest();
  const presentedDigest = digest(presented);

  // No early exit: the time taken must not say which entry matched.
  return secrets.map((secret) => timingSafeEqual(digest(secret), presentedDigest)).reduce((a, b) => a || b, false);
};

export const parseBearer = (header: string | undefined) => {
  const match = /^Bearer\s+(\S+)$/.exec(header ?? '');

  return match ? match[1] : undefined;
};

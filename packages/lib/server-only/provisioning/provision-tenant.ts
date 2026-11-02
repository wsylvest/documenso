import { prisma } from '@documenso/prisma';
import { OrganisationType } from '@prisma/client';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { INTERNAL_CLAIM_ID } from '../../types/subscription';
import { env } from '../../utils/env';
import { createOrganisation } from '../organisation/create-organisation';
import { createApiToken } from '../public-api/create-api-token';
import { getSubscriptionClaim } from '../subscription/get-subscription-claim';
import { createTeam } from '../team/create-team';
import { createAdminUser } from '../user/create-admin-user';
import { assertNotPrivateUrl } from '../webhooks/assert-webhook-url';
import {
  DEFAULT_TENANT_WEBHOOK_EVENTS,
  TENANT_API_TOKEN_NAME,
  type TProvisionTenantRequest,
  type TProvisionTenantResult,
  type TTenantStatus,
} from './provision-tenant.types';

const OWNER_EMAIL_DOMAIN = () => env('NEXT_PRIVATE_PROVISIONING_OWNER_DOMAIN') || 'smartroofing.ai';

const ownerEmail = (slug: string) => `sign+${slug}@${OWNER_EMAIL_DOMAIN()}`;

const alreadyTaken = (what: string) =>
  new AppError(AppErrorCode.ALREADY_EXISTS, {
    message: `${what} already exists and was not provisioned for this company.`,
  });

/**
 * Create, or complete, one company's place on this instance: a service owner
 * (no password, so nobody can sign in as it), the organisation, the team, the
 * webhook the estimator listens on, and a team API token.
 *
 * Idempotent on `slug`. Re-running never duplicates anything and never returns
 * an existing token: the token is stored hashed and cannot be read back, so a
 * caller that lost it passes `rotateToken`, which revokes the old one.
 */
export const provisionTenant = async (input: TProvisionTenantRequest): Promise<TProvisionTenantResult> => {
  const { slug, name, webhookUrl, webhookSecret, rotateToken } = input;

  await assertNotPrivateUrl(webhookUrl);

  const email = ownerEmail(slug);

  const owner =
    (await prisma.user.findFirst({ where: { email } })) ??
    (await createAdminUser({ name: `SmartRoofing Sign: ${name}`, email }));

  let organisation = await prisma.organisation.findFirst({ where: { url: slug } });
  let created = false;

  if (organisation && organisation.ownerUserId !== owner.id) {
    throw alreadyTaken('An organisation with this URL');
  }

  if (!organisation) {
    const claim = await getSubscriptionClaim(INTERNAL_CLAIM_ID.FREE);

    organisation = await createOrganisation({
      userId: owner.id,
      name,
      type: OrganisationType.ORGANISATION,
      url: slug,
      claim,
    });
    created = true;

    await applyOrganisationDefaults(organisation.organisationGlobalSettingsId, input);
  }

  let team = await prisma.team.findFirst({ where: { organisationId: organisation.id, url: slug } });

  if (!team) {
    await createTeam({
      userId: owner.id,
      teamName: name,
      teamUrl: slug,
      organisationId: organisation.id,
      inheritMembers: false,
    });

    team = await prisma.team.findFirstOrThrow({ where: { organisationId: organisation.id, url: slug } });
  }

  const webhook = await upsertWebhook({
    teamId: team.id,
    userId: owner.id,
    url: webhookUrl,
    secret: webhookSecret,
    events: input.webhookEvents ?? DEFAULT_TENANT_WEBHOOK_EVENTS,
  });

  const existingTokens = await prisma.apiToken.findMany({
    where: { teamId: team.id, name: TENANT_API_TOKEN_NAME },
    select: { id: true },
  });

  let apiToken: string | null = null;

  if (rotateToken || existingTokens.length === 0) {
    const issued = await createApiToken({
      userId: owner.id,
      teamId: team.id,
      tokenName: TENANT_API_TOKEN_NAME,
      expiresIn: null,
    });

    apiToken = issued.token;

    if (existingTokens.length > 0) {
      await prisma.apiToken.deleteMany({ where: { id: { in: existingTokens.map((t) => t.id) } } });
    }
  }

  return {
    organisationId: organisation.id,
    organisationUrl: organisation.url,
    teamId: team.id,
    teamUrl: team.url,
    webhookId: webhook.id,
    created,
    apiToken,
  };
};

const applyOrganisationDefaults = async (settingsId: string, input: TProvisionTenantRequest) => {
  await prisma.organisationGlobalSettings.update({
    where: { id: settingsId },
    data: {
      documentDateFormat: 'MM/dd/yyyy hh:mm a',
      includeSigningCertificate: true,
      includeAuditLog: true,
      brandingEnabled: true,
      brandingUrl: input.settings?.brandingUrl ?? 'https://smartroofing.ai',
      brandingCompanyDetails: input.settings?.brandingCompanyDetails ?? input.name,
      emailReplyTo: input.settings?.emailReplyTo ?? null,
    },
  });
};

const upsertWebhook = async (options: {
  teamId: number;
  userId: number;
  url: string;
  secret: string;
  events: TProvisionTenantRequest['webhookEvents'] & object;
}) => {
  const existing = await prisma.webhook.findFirst({ where: { teamId: options.teamId, webhookUrl: options.url } });

  const data = { secret: options.secret, eventTriggers: options.events, enabled: true };

  if (existing) {
    return await prisma.webhook.update({ where: { id: existing.id }, data });
  }

  return await prisma.webhook.create({
    data: { ...data, webhookUrl: options.url, userId: options.userId, teamId: options.teamId },
  });
};

/** What exists for a slug, without any secret. Null when it was never provisioned. */
export const getTenantStatus = async (slug: string): Promise<TTenantStatus | null> => {
  const team = await prisma.team.findFirst({
    where: { url: slug, organisation: { url: slug } },
    include: {
      webhooks: { select: { id: true, enabled: true, eventTriggers: true } },
      apiTokens: { where: { name: TENANT_API_TOKEN_NAME }, select: { name: true, createdAt: true, lastUsedAt: true } },
    },
  });

  if (!team) {
    return null;
  }

  const webhook = team.webhooks[0] ?? null;

  return {
    organisationId: team.organisationId,
    teamId: team.id,
    webhook: webhook ? { id: webhook.id, enabled: webhook.enabled, events: webhook.eventTriggers } : null,
    apiTokens: team.apiTokens,
  };
};

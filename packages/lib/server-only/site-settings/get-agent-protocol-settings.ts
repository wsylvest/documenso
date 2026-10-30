import { prisma } from '@documenso/prisma';

import { SITE_SETTINGS_AGENT_PROTOCOLS_ID, ZSiteSettingsAgentProtocolsSchema } from './schemas/agent-protocols';

export type TAgentProtocolSettings = {
  mcpEnabled: boolean;
  acpEnabled: boolean;
};

/**
 * Both protocols are on unless a super-admin has switched them off, so an
 * instance without the setting row behaves exactly as before the switch existed.
 */
export const DEFAULT_AGENT_PROTOCOL_SETTINGS: TAgentProtocolSettings = {
  mcpEnabled: true,
  acpEnabled: true,
};

/**
 * How long a lookup is reused before the database is consulted again. The
 * setting is read on every MCP and ACP request, so it must not cost a query
 * each time; a 30 second lag after an admin flips a switch is acceptable.
 */
export const AGENT_PROTOCOL_SETTINGS_CACHE_TTL_MS = 30_000;

type CacheEntry = {
  value: TAgentProtocolSettings;
  expiresAt: number;
};

let cache: CacheEntry | null = null;

/**
 * Drop the in-process cache so the next lookup hits the database. Called by
 * `upsertSiteSetting` after the row changes so the process that handled the
 * admin request applies the change immediately.
 */
export const clearAgentProtocolSettingsCache = () => {
  cache = null;
};

const loadAgentProtocolSettings = async (): Promise<TAgentProtocolSettings> => {
  const setting = await prisma.siteSettings.findFirst({
    where: {
      id: SITE_SETTINGS_AGENT_PROTOCOLS_ID,
    },
  });

  if (!setting) {
    return DEFAULT_AGENT_PROTOCOL_SETTINGS;
  }

  const parsed = ZSiteSettingsAgentProtocolsSchema.safeParse(setting);

  // A row that fails to parse must never lock the protocols in either
  // direction, so fall back to the defaults the same way a missing row does.
  if (!parsed.success) {
    return DEFAULT_AGENT_PROTOCOL_SETTINGS;
  }

  return {
    mcpEnabled: parsed.data.data.mcpEnabled,
    acpEnabled: parsed.data.data.acpEnabled,
  };
};

/**
 * Resolve the instance-wide agent protocol switches, cached in process for
 * `AGENT_PROTOCOL_SETTINGS_CACHE_TTL_MS`.
 *
 * Multiple instances each hold their own cache, so a change made through the
 * admin UI reaches every instance within the TTL rather than instantly.
 */
export const getAgentProtocolSettings = async (): Promise<TAgentProtocolSettings> => {
  const now = Date.now();

  if (cache && cache.expiresAt > now) {
    return cache.value;
  }

  const value = await loadAgentProtocolSettings();

  cache = {
    value,
    expiresAt: now + AGENT_PROTOCOL_SETTINGS_CACHE_TTL_MS,
  };

  return value;
};

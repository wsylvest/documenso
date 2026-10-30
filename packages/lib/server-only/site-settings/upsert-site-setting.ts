import { prisma } from '@documenso/prisma';

import { clearAgentProtocolSettingsCache } from './get-agent-protocol-settings';
import type { TSiteSettingSchema } from './schema';
import { SITE_SETTINGS_AGENT_PROTOCOLS_ID } from './schemas/agent-protocols';

export type UpsertSiteSettingOptions = TSiteSettingSchema & {
  userId?: number | null;
};

export const upsertSiteSetting = async ({ id, enabled, data, userId }: UpsertSiteSettingOptions) => {
  const setting = await prisma.siteSettings.upsert({
    where: {
      id,
    },
    create: {
      id,
      enabled,
      data,
      lastModifiedByUserId: userId,
      lastModifiedAt: new Date(),
    },
    update: {
      enabled,
      data,
      lastModifiedByUserId: userId,
      lastModifiedAt: new Date(),
    },
  });

  if (id === SITE_SETTINGS_AGENT_PROTOCOLS_ID) {
    clearAgentProtocolSettingsCache();
  }

  return setting;
};

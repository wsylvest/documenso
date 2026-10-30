import { z } from 'zod';

import { ZSiteSettingsBaseSchema } from './_base';

export const SITE_SETTINGS_AGENT_PROTOCOLS_ID = 'agent.protocols';

/**
 * Instance-wide kill switches for the agent protocol servers (MCP at `/api/mcp`
 * and ACP at `/api/acp`). Each protocol is still gated by its deployment flag
 * (`NEXT_PUBLIC_MCP_ENABLED` / `NEXT_PUBLIC_ACP_ENABLED`), which decides whether
 * the routes are mounted at all; this setting lets a super-admin switch a
 * mounted server off without a restart.
 *
 * Both protocols default to enabled when the row does not exist so that
 * instances that never visit the admin page keep today's behaviour. The
 * base `enabled` column is kept `true` and carries no meaning here; the
 * per-protocol switches live in `data`.
 */
export const ZSiteSettingsAgentProtocolsSchema = ZSiteSettingsBaseSchema.extend({
  id: z.literal(SITE_SETTINGS_AGENT_PROTOCOLS_ID),
  data: z
    .object({
      mcpEnabled: z.boolean().default(true),
      acpEnabled: z.boolean().default(true),
    })
    .optional()
    .default({
      mcpEnabled: true,
      acpEnabled: true,
    }),
});

export type TSiteSettingsAgentProtocolsSchema = z.infer<typeof ZSiteSettingsAgentProtocolsSchema>;

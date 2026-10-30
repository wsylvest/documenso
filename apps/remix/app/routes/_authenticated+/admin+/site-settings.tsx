import { getSiteSettings } from '@documenso/lib/server-only/site-settings/get-site-settings';
import { SITE_SETTINGS_AGENT_PROTOCOLS_ID } from '@documenso/lib/server-only/site-settings/schemas/agent-protocols';
import { SITE_SETTINGS_BANNER_ID } from '@documenso/lib/server-only/site-settings/schemas/banner';
import { SITE_SETTINGS_EMAIL_BLOCKLIST_ID } from '@documenso/lib/server-only/site-settings/schemas/email-blocklist';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';

import { AdminAgentProtocolsSection } from '~/components/general/admin-agent-protocols-section';
import { AdminEmailBlocklistSection } from '~/components/general/admin-email-blocklist-section';
import { AdminSiteBannerSection } from '~/components/general/admin-site-banner-section';
import { SettingsHeader } from '~/components/general/settings-header';
import type { Route } from './+types/site-settings';

export async function loader() {
  const settings = await getSiteSettings();

  const banner = settings.find((setting) => setting.id === SITE_SETTINGS_BANNER_ID);
  const emailBlocklist = settings.find((setting) => setting.id === SITE_SETTINGS_EMAIL_BLOCKLIST_ID);
  const agentProtocols = settings.find((setting) => setting.id === SITE_SETTINGS_AGENT_PROTOCOLS_ID);

  return { banner, emailBlocklist, agentProtocols };
}

export default function AdminSiteSettingsPage({ loaderData }: Route.ComponentProps) {
  const { banner, emailBlocklist, agentProtocols } = loaderData;

  const { _ } = useLingui();

  return (
    <div>
      <SettingsHeader title={_(msg`Site Settings`)} subtitle={_(msg`Manage your site settings here`)} />

      <div className="mt-8 space-y-12">
        <AdminSiteBannerSection banner={banner} />

        <AdminEmailBlocklistSection emailBlocklist={emailBlocklist} />

        <AdminAgentProtocolsSection agentProtocols={agentProtocols} />
      </div>
    </div>
  );
}

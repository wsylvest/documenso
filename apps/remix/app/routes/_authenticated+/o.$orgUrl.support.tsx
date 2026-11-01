import { useCurrentOrganisation } from '@documenso/lib/client-only/providers/organisation';
import { useSession } from '@documenso/lib/client-only/providers/session';
import { COMPANY_NAME, IS_BILLING_ENABLED, SUPPORT_EMAIL } from '@documenso/lib/constants/app';
import { Button } from '@documenso/ui/primitives/button';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BookIcon, HelpCircleIcon, Link2Icon, MailIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { SupportTicketForm } from '~/components/forms/support-ticket-form';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags(msg`Support`);
}

export default function SupportPage() {
  const [showForm, setShowForm] = useState(false);
  const { user } = useSession();
  const organisation = useCurrentOrganisation();

  const [searchParams] = useSearchParams();

  const teamId = searchParams.get('team');

  const subscriptionStatus = organisation.subscription?.status;

  const handleSuccess = () => {
    setShowForm(false);
  };

  const handleCloseForm = () => {
    setShowForm(false);
  };

  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 md:px-8">
      <div className="mb-8">
        <h1 className="flex flex-row items-center gap-2 font-bold text-3xl">
          <HelpCircleIcon className="h-8 w-8 text-muted-foreground" />
          <Trans>Support</Trans>
        </h1>

        <p className="mt-2 text-muted-foreground">
          <Trans>Here is how to get help:</Trans>
        </p>

        <div className="mt-6 flex flex-col gap-4">
          <div className="rounded-lg border p-4">
            <h2 className="flex items-center gap-2 font-bold text-lg">
              <MailIcon className="h-5 w-5 text-muted-foreground" />
              <Link to={`mailto:${SUPPORT_EMAIL}`} className="hover:underline">
                <Trans>Email support</Trans>
              </Link>
            </h2>
            <p className="mt-1 text-muted-foreground">
              <Trans>
                Write to {COMPANY_NAME} at {SUPPORT_EMAIL} and we will get back to you as soon as possible.
              </Trans>
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <h2 className="flex items-center gap-2 font-bold text-lg">
              <BookIcon className="h-5 w-5 text-muted-foreground" />
              <Link
                to="https://docs.documenso.com"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                <Trans>Platform documentation</Trans>
              </Link>
            </h2>
            <p className="mt-1 text-muted-foreground">
              <Trans>
                SR Sign is built on the open-source Documenso platform. Its documentation covers templates, fields and
                the API.
              </Trans>
            </p>
          </div>
          {organisation && IS_BILLING_ENABLED() && subscriptionStatus && (
            <div className="rounded-lg border p-4">
              <h2 className="flex items-center gap-2 font-bold text-lg">
                <Link2Icon className="h-5 w-5 text-muted-foreground" />
                <Trans>Contact us</Trans>
              </h2>
              <p className="mt-1 text-muted-foreground">
                <Trans>We'll get back to you as soon as possible via email.</Trans>
              </p>
              <div className="mt-4">
                {!showForm ? (
                  <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
                    <Trans>Create a support ticket</Trans>
                  </Button>
                ) : (
                  <SupportTicketForm
                    organisationId={organisation.id}
                    teamId={teamId}
                    onSuccess={handleSuccess}
                    onClose={handleCloseForm}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

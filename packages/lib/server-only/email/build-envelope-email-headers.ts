export type BuildEnvelopeEmailHeadersOptions = {
  userId: number;
  envelopeId: string;
  teamId: number;
};

/**
 * Builds opaque sender-attribution headers stamped onto outgoing user-triggered
 * envelope emails. These appear in AWS SES bounce/complaint notifications (when
 * "include original headers" is enabled) so an abusive send can be traced back
 * to the originating Documenso user via the admin panel.
 *
 * Only opaque IDs are included so recipients cannot see the sender's email
 * address or name in the delivered message source.
 */
export const buildEnvelopeEmailHeaders = ({
  userId,
  envelopeId,
  teamId,
}: BuildEnvelopeEmailHeadersOptions): Record<string, string> => {
  return {
    'X-SR-Sign-Sender-User-Id': String(userId),
    'X-SR-Sign-Envelope-Id': envelopeId,
    'X-SR-Sign-Team-Id': String(teamId),
    // Legacy names, kept so existing mail rules and webhooks keep matching.
    'X-Documenso-Sender-User-Id': String(userId),
    'X-Documenso-Envelope-Id': envelopeId,
    'X-Documenso-Team-Id': String(teamId),
  };
};

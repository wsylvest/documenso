import { router } from '../trpc';
import { completeSigningRoute } from './complete-signing';
import { getSigningEnvelopeRoute } from './get-signing-envelope';
import { getSigningStatusRoute } from './get-signing-status';
import { rejectSigningRoute } from './reject-signing';
import { requestSigningAccessCodeRoute } from './request-signing-access-code';
import { signSigningFieldRoute } from './sign-signing-field';
import { viewSigningEnvelopeRoute } from './view-signing-envelope';

/**
 * Public signing API.
 *
 * Lets an integration drive the recipient signing flow from its own UI instead
 * of the Documenso signing page or embed. Every route is authenticated with an
 * API token, scoped to the token's team, and keyed by the recipient signing
 * token. Signer connection details may be forwarded so the audit log records
 * the signer rather than the integration's server.
 */
export const signingRouter = router({
  getEnvelope: getSigningEnvelopeRoute,
  getStatus: getSigningStatusRoute,
  view: viewSigningEnvelopeRoute,
  signField: signSigningFieldRoute,
  complete: completeSigningRoute,
  reject: rejectSigningRoute,
  requestAccessCode: requestSigningAccessCodeRoute,
});

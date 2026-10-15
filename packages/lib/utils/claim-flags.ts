import { IS_BILLING_ENABLED } from '../constants/app';
import type { TClaimFlags } from '../types/subscription';

/**
 * Flags that are never implied by a billing-disabled instance and must be set
 * explicitly on the organisation claim.
 *
 * - `disableEmails` is an admin control, not a capability.
 * - `allowLegacyEnvelopes` is opt-in so the deprecated legacy upload path stays
 *   hidden by default.
 */
const EXPLICIT_ONLY_CLAIM_FLAGS: ReadonlySet<keyof TClaimFlags> = new Set(['disableEmails', 'allowLegacyEnvelopes']);

/** Billing-disabled instances have every capability except the explicit-only flags above. */
export const isClaimFlagEnabled = (flags: TClaimFlags | undefined, key: keyof TClaimFlags): boolean => {
  return (!IS_BILLING_ENABLED() && !EXPLICIT_ONLY_CLAIM_FLAGS.has(key)) || flags?.[key] === true;
};

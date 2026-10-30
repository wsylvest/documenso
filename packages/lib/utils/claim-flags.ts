import { IS_BILLING_ENABLED } from '../constants/app';
import type { TClaimFlags } from '../types/subscription';

/**
 * Flags that are never implied by a billing-disabled instance and must be set
 * explicitly on the organisation claim.
 *
 * - `disableEmails` is an admin control, not a capability.
 * - `allowLegacyEnvelopes` is opt-in so the deprecated legacy upload path stays
 *   hidden by default.
 * - `mcpAccess` and `acpAccess` are opt-in so a super-admin grants each
 *   organisation access to the MCP and ACP agent servers deliberately, even
 *   when billing is off and every other capability is implied.
 */
export const EXPLICIT_ONLY_CLAIM_FLAGS: ReadonlySet<keyof TClaimFlags> = new Set([
  'disableEmails',
  'allowLegacyEnvelopes',
  'mcpAccess',
  'acpAccess',
]);

/**
 * Whether a flag must be set explicitly on the claim rather than being implied
 * by a billing-disabled instance. Used by the admin UI to keep these flags
 * editable while every other flag is shown as always on.
 */
export const isExplicitOnlyClaimFlag = (key: keyof TClaimFlags): boolean => EXPLICIT_ONLY_CLAIM_FLAGS.has(key);

/** Billing-disabled instances have every capability except the explicit-only flags above. */
export const isClaimFlagEnabled = (flags: TClaimFlags | undefined, key: keyof TClaimFlags): boolean => {
  return (!IS_BILLING_ENABLED() && !EXPLICIT_ONLY_CLAIM_FLAGS.has(key)) || flags?.[key] === true;
};

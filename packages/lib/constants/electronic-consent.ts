/**
 * Version of the consumer consent disclosure shown before signing.
 *
 * Bump this whenever the wording of the consent dialog or the signature
 * disclosure article changes so the audit log records which text a recipient
 * agreed to.
 */
export const ELECTRONIC_CONSENT_DISCLOSURE_VERSION = '2026-11-01';

/**
 * Rejection reason recorded when a recipient declines electronic signing and
 * asks for a paper copy instead. Kept as a constant so the signing UI and the
 * owner-facing notices can recognise it.
 */
export const PAPER_COPY_REQUESTED_REJECTION_REASON =
  'Recipient declined to sign electronically and requested a paper copy of the document.';

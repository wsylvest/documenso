import { z } from 'zod';

/**
 * Headers an integration can send to forward the signer's real client details
 * when it proxies signing calls from its own backend.
 */
export const SIGNER_IP_ADDRESS_HEADER = 'x-signer-ip-address';
export const SIGNER_USER_AGENT_HEADER = 'x-signer-user-agent';

export const ZSigningTokenSchema = z
  .string()
  .min(1)
  .describe('The recipient signing token. Returned by the distribute endpoint and embedded in signing URLs.');

export const ZSignerIpAddressSchema = z.string().ip().describe('The IPv4 or IPv6 address of the signer.');

export const ZSignerUserAgentSchema = z.string().min(1).max(1024).describe('The browser user agent of the signer.');

/**
 * Optional signer details recorded in the audit log in place of the API
 * caller's own connection details. Only honoured for API token requests.
 */
export const ZSignerMetadataSchema = z
  .object({
    ipAddress: ZSignerIpAddressSchema.optional(),
    userAgent: ZSignerUserAgentSchema.optional(),
  })
  .describe(
    "Details of the signer performing the action. When your backend proxies the request, forward the signer's IP address and user agent here (or via the X-Signer-IP-Address and X-Signer-User-Agent headers) so the audit trail records the signer rather than your server. Ignored for session requests.",
  );

export type TSignerMetadata = z.infer<typeof ZSignerMetadataSchema>;

export const ZSignerMetadataHeadersSchema = z.object({
  [SIGNER_IP_ADDRESS_HEADER]: ZSignerIpAddressSchema.optional(),
  [SIGNER_USER_AGENT_HEADER]: ZSignerUserAgentSchema.optional(),
});

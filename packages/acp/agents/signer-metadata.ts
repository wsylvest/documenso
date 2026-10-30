import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import type { RequestMetadata } from '@documenso/lib/universal/extract-request-metadata';
import {
  type TSignerMetadata,
  ZSignerIpAddressSchema,
  ZSignerUserAgentSchema,
} from '@documenso/trpc/server/signing-router/schema';
import type { Logger } from 'pino';

import type { AcpPrincipal } from './types';

type ResolveSignerRequestMetadataOptions = {
  principal: AcpPrincipal;
  logger: Logger;

  /**
   * Signer details supplied in the agent input. Take precedence over the
   * `X-Signer-IP-Address` / `X-Signer-User-Agent` headers of the run request.
   */
  signer?: TSignerMetadata;
};

/**
 * Work out which IP address and user agent should be written to the audit log
 * for a signing action.
 *
 * Mirrors `resolveSignerRequestMetadata` in the native Signing API: ACP
 * callers are always API token callers proxying the signer from their own
 * backend, so they may forward the signer's real details in the input or via
 * headers. Anything else falls back to the connection metadata.
 */
export const resolveSignerRequestMetadata = ({
  principal,
  logger,
  signer,
}: ResolveSignerRequestMetadataOptions): RequestMetadata => {
  const connectionMetadata = principal.metadata.requestMetadata;

  if (principal.metadata.auth !== 'api') {
    return connectionMetadata;
  }

  const forwardedIpAddress = signer?.ipAddress ?? principal.forwardedSigner?.ipAddress;
  const forwardedUserAgent = signer?.userAgent ?? principal.forwardedSigner?.userAgent;

  if (forwardedIpAddress === undefined && forwardedUserAgent === undefined) {
    return connectionMetadata;
  }

  const parsedIpAddress = ZSignerIpAddressSchema.optional().safeParse(forwardedIpAddress);

  if (!parsedIpAddress.success) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Forwarded signer IP address is not a valid IPv4 or IPv6 address',
      statusCode: 400,
    });
  }

  const parsedUserAgent = ZSignerUserAgentSchema.optional().safeParse(forwardedUserAgent);

  if (!parsedUserAgent.success) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Forwarded signer user agent must be between 1 and 1024 characters',
      statusCode: 400,
    });
  }

  logger.info({
    message: 'Using forwarded signer metadata for audit log',
    forwardedIpAddress: parsedIpAddress.data,
    forwardedUserAgent: parsedUserAgent.data,
  });

  return {
    ipAddress: parsedIpAddress.data ?? connectionMetadata.ipAddress,
    userAgent: parsedUserAgent.data ?? connectionMetadata.userAgent,
  };
};

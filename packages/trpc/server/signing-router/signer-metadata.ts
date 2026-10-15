import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import type { RequestMetadata } from '@documenso/lib/universal/extract-request-metadata';
import type { Logger } from 'pino';

import type { TrpcContext } from '../context';
import {
  SIGNER_IP_ADDRESS_HEADER,
  SIGNER_USER_AGENT_HEADER,
  type TSignerMetadata,
  ZSignerIpAddressSchema,
  ZSignerUserAgentSchema,
} from './schema';

type ResolveSignerRequestMetadataOptions = {
  ctx: Pick<TrpcContext, 'req' | 'metadata'> & { logger: Logger };

  /**
   * Signer details supplied in the request body. Take precedence over headers.
   */
  signer?: TSignerMetadata;
};

/**
 * Work out which IP address and user agent should be written to the audit log
 * for a signing action.
 *
 * The signing UI calls the API from the signer's browser so the connection
 * metadata already belongs to the signer. An integration calling from its own
 * backend does not, so API token callers may forward the signer's details in
 * the body or via headers. Session callers are never allowed to override the
 * connection metadata.
 */
export const resolveSignerRequestMetadata = ({ ctx, signer }: ResolveSignerRequestMetadataOptions): RequestMetadata => {
  const connectionMetadata = ctx.metadata.requestMetadata;

  if (ctx.metadata.auth !== 'api') {
    return connectionMetadata;
  }

  const forwardedIpAddress = signer?.ipAddress ?? ctx.req.headers.get(SIGNER_IP_ADDRESS_HEADER) ?? undefined;
  const forwardedUserAgent = signer?.userAgent ?? ctx.req.headers.get(SIGNER_USER_AGENT_HEADER) ?? undefined;

  if (forwardedIpAddress === undefined && forwardedUserAgent === undefined) {
    return connectionMetadata;
  }

  const parsedIpAddress = ZSignerIpAddressSchema.optional().safeParse(forwardedIpAddress);

  if (!parsedIpAddress.success) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `Forwarded signer IP address is not a valid IPv4 or IPv6 address`,
    });
  }

  const parsedUserAgent = ZSignerUserAgentSchema.optional().safeParse(forwardedUserAgent);

  if (!parsedUserAgent.success) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `Forwarded signer user agent must be between 1 and 1024 characters`,
    });
  }

  ctx.logger.info({
    message: 'Using forwarded signer metadata for audit log',
    forwardedIpAddress: parsedIpAddress.data,
    forwardedUserAgent: parsedUserAgent.data,
  });

  return {
    ipAddress: parsedIpAddress.data ?? connectionMetadata.ipAddress,
    userAgent: parsedUserAgent.data ?? connectionMetadata.userAgent,
  };
};

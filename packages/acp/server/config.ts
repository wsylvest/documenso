import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { env } from '@documenso/lib/utils/env';

export const ACP_BASE_PATH = '/api/acp';

export const ACP_PROTOCOL_VERSION = 'acp/openapi-main-2025-08';

export const A2A_PROTOCOL_VERSION = '1.0';

export const isAcpEnabled = (): boolean => env('NEXT_PUBLIC_ACP_ENABLED') === 'true';

/**
 * How long `mode: sync` waits for a run to settle before returning the run in
 * whatever state it reached. Defaults to 60 seconds.
 */
export const getAcpSyncTimeoutMs = (): number => {
  const raw = Number(env('NEXT_PRIVATE_ACP_SYNC_TIMEOUT_MS'));

  if (!Number.isFinite(raw) || raw <= 0) {
    return 60_000;
  }

  return raw;
};

export const getAcpBaseUrl = (): string => `${NEXT_PUBLIC_WEBAPP_URL()}${ACP_BASE_PATH}`;

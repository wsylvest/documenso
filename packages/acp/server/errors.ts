import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { ZodError } from 'zod';

import type { TAcpError, TAcpErrorCode } from '../protocol/schemas';

export type AcpHttpError = {
  status: number;
  body: TAcpError;
};

const codeForStatus = (status: number): TAcpErrorCode => {
  if (status === 404) {
    return 'not_found';
  }

  if (status >= 400 && status < 500) {
    return 'invalid_input';
  }

  return 'server_error';
};

/**
 * Map any thrown value onto an ACP `Error` body and an HTTP status.
 *
 * Only the three codes from the specification are used so conformant clients
 * can validate the body; the application error code travels in `data.code`.
 */
export const toAcpError = (error: unknown): AcpHttpError => {
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        code: 'invalid_input',
        message: 'Request failed validation',
        data: {
          code: AppErrorCode.SCHEMA_FAILED,
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
    };
  }

  if (error instanceof AppError) {
    const status = error.statusCode ?? AppError.toRestAPIError(error).status;

    return {
      status,
      body: {
        code: codeForStatus(status),
        message: error.userMessage ?? error.message,
        data: {
          code: error.code,
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      code: 'server_error',
      message: 'Internal server error',
      data: {
        code: AppErrorCode.UNKNOWN_ERROR,
      },
    },
  };
};

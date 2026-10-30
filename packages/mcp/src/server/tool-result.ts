import { AppError, genericErrorCodeToTrpcErrorCodeMap } from '@documenso/lib/errors/app-error';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TRPCError } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';

export type McpToolError = {
  code: string;
  message: string;
  status: number;
};

/**
 * Convert anything thrown by a tool into a stable `{ code, message, status }`.
 *
 * Procedures called through the tRPC caller throw `TRPCError` with the original
 * `AppError` as `cause`, so the `AppErrorCode` is preserved for clients.
 */
export const normaliseToolError = (error: unknown): McpToolError => {
  const cause = error instanceof TRPCError && error.cause ? error.cause : error;

  if (cause instanceof AppError) {
    return {
      code: cause.code,
      message: cause.message || cause.userMessage || cause.code,
      status: cause.statusCode ?? genericErrorCodeToTrpcErrorCodeMap[cause.code]?.status ?? 400,
    };
  }

  if (error instanceof TRPCError) {
    return {
      code: error.code,
      message: error.message,
      status: getHTTPStatusCodeFromError(error),
    };
  }

  if (error instanceof Error) {
    return {
      code: 'UNKNOWN_ERROR',
      message: error.message,
      status: 500,
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: 'An unknown error occurred',
    status: 500,
  };
};

/**
 * Error results carry the code in the text (for the model) and in `_meta.error`
 * (for programmatic clients). `structuredContent` is deliberately omitted:
 * clients validate it against the tool's output schema even on errors.
 */
export const toolErrorResult = (error: McpToolError): CallToolResult => ({
  isError: true,
  content: [
    {
      type: 'text',
      text: `${error.code}: ${error.message}`,
    },
  ],
  _meta: {
    error: {
      code: error.code,
      message: error.message,
      status: error.status,
    },
  },
});

/**
 * JSON-serialisable copy of a value (dates become ISO strings) for the text
 * content block that accompanies structured output.
 */
export const toJsonText = (value: unknown): string => JSON.stringify(value, null, 2);

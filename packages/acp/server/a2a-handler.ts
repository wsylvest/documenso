import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import type { Logger } from 'pino';
import { ZodError } from 'zod';

import { listAgents } from '../agents/registry';
import type { AcpPrincipal } from '../agents/types';
import {
  A2A_METHOD_ALIASES,
  a2aMessageToAcpInput,
  acpRunToA2aTask,
  JSON_RPC_ERROR_CODES,
  type TJsonRpcRequest,
  ZA2aSendMessageParamsSchema,
  ZA2aTaskIdParamsSchema,
  ZJsonRpcRequestSchema,
} from '../protocol/a2a';
import { ZAwaitResumeSchema } from '../protocol/schemas';
import { awaitRunForSync, cancelRun, resumeRun, startRun } from '../runs/run-service';
import { getRunInput, getRunOrThrow, toAcpRun } from '../runs/run-store';
import { toAcpError } from './errors';

type JsonRpcId = string | number | null;

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
  | { jsonrpc: '2.0'; id: JsonRpcId; error: { code: number; message: string; data?: unknown } };

const rpcError = (id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message, data },
});

const rpcResult = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result });

const appErrorToRpcError = (id: JsonRpcId, error: unknown): JsonRpcResponse => {
  if (error instanceof ZodError) {
    return rpcError(id, JSON_RPC_ERROR_CODES.invalidParams, 'Invalid params', toAcpError(error).body.data);
  }

  if (error instanceof AppError) {
    const { status, body } = toAcpError(error);

    if (status === 404) {
      return rpcError(id, JSON_RPC_ERROR_CODES.taskNotFound, body.message, body.data);
    }

    if (status === 409) {
      return rpcError(id, JSON_RPC_ERROR_CODES.taskNotCancelable, body.message, body.data);
    }

    if (status >= 400 && status < 500) {
      return rpcError(id, JSON_RPC_ERROR_CODES.invalidParams, body.message, body.data);
    }
  }

  return rpcError(id, JSON_RPC_ERROR_CODES.internalError, 'Internal error', { code: AppErrorCode.UNKNOWN_ERROR });
};

type HandleOptions = {
  principal: AcpPrincipal;
  logger: Logger;
};

/**
 * Dispatch one JSON-RPC request. Authentication has already happened; the
 * HTTP layer decides the status code (always 200 for well-formed JSON-RPC).
 */
export const handleA2aJsonRpc = async (
  rawBody: unknown,
  { principal, logger }: HandleOptions,
): Promise<JsonRpcResponse> => {
  const parsed = ZJsonRpcRequestSchema.safeParse(rawBody);

  if (!parsed.success) {
    return rpcError(null, JSON_RPC_ERROR_CODES.invalidRequest, 'Invalid JSON-RPC request');
  }

  const request: TJsonRpcRequest = parsed.data;
  const id: JsonRpcId = request.id ?? null;

  const method = A2A_METHOD_ALIASES[request.method];

  if (!method) {
    return rpcError(id, JSON_RPC_ERROR_CODES.methodNotFound, `Method "${request.method}" is not supported`);
  }

  logger.info({ msg: 'A2A request', a2aMethod: request.method });

  try {
    switch (method) {
      case 'SendMessage': {
        const params = ZA2aSendMessageParamsSchema.parse(request.params);
        const { agentName, input, taskId, contextId } = a2aMessageToAcpInput(params.message, listAgents());

        // A message addressed to an existing task resumes it.
        if (taskId) {
          const existing = await getRunOrThrow({ runId: taskId, teamId: principal.teamId });
          const awaitResume = buildAwaitResume(existing.awaitRequest, input[0].parts);

          const started = await resumeRun({ principal, logger, runId: taskId, awaitResume });
          const run = await awaitRunForSync(started, principal.teamId);

          return rpcResult(id, acpRunToA2aTask(run, getRunInput(existing)));
        }

        if (!agentName) {
          return rpcError(
            id,
            JSON_RPC_ERROR_CODES.invalidParams,
            'message.metadata.skill must name one of the skills in the Agent Card',
          );
        }

        const started = await startRun({
          principal,
          logger,
          agentName,
          input,
          sessionId: contextId ?? null,
        });

        const run = await awaitRunForSync(started, principal.teamId);

        return rpcResult(id, acpRunToA2aTask(run, input));
      }

      case 'GetTask': {
        const params = ZA2aTaskIdParamsSchema.parse(request.params);
        const run = await getRunOrThrow({ runId: params.id, teamId: principal.teamId });

        return rpcResult(id, acpRunToA2aTask(toAcpRun(run), getRunInput(run)));
      }

      case 'CancelTask': {
        const params = ZA2aTaskIdParamsSchema.parse(request.params);
        const run = await cancelRun({ principal, logger, runId: params.id });

        return rpcResult(id, acpRunToA2aTask(toAcpRun(run), getRunInput(run)));
      }
    }
  } catch (error) {
    logger.error({ msg: 'A2A request failed', a2aMethod: request.method, err: error });

    return appErrorToRpcError(id, error);
  }
};

/**
 * An A2A follow-up message carries the resume payload as a data part. The
 * `type` defaults to the pending await request's type so A2A clients do not
 * need to know ACP's await semantics.
 */
const buildAwaitResume = (awaitRequest: unknown, parts: { content_type: string; content?: string }[]) => {
  const pendingType =
    awaitRequest && typeof awaitRequest === 'object' && 'type' in awaitRequest
      ? String((awaitRequest as { type: unknown }).type)
      : 'message';

  const dataPart = parts.find((part) => part.content_type === 'application/json' && part.content !== undefined);

  let payload: Record<string, unknown> = {};

  if (dataPart?.content) {
    try {
      const parsedPayload: unknown = JSON.parse(dataPart.content);

      if (parsedPayload && typeof parsedPayload === 'object' && !Array.isArray(parsedPayload)) {
        payload = parsedPayload as Record<string, unknown>;
      }
    } catch {
      throw new AppError(AppErrorCode.INVALID_BODY, {
        message: 'Resume data part is not valid JSON',
        statusCode: 400,
      });
    }
  }

  return ZAwaitResumeSchema.parse({ type: pendingType, ...payload });
};

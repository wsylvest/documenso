import { randomUUID } from 'node:crypto';

import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { prisma } from '@documenso/prisma';
import type { AcpRun, AcpRunEvent } from '@prisma/client';
import { AcpRunStatus, Prisma } from '@prisma/client';

import type { AcpPrincipal } from '../agents/types';
import type { TAcpError, TAwaitRequest, TAwaitResume, TEvent, TMessage, TRun, TRunStatus } from '../protocol/schemas';
import { ZAcpErrorSchema, ZAwaitRequestSchema, ZMessageSchema } from '../protocol/schemas';
import { fromPrismaRunStatus, toPrismaRunStatus } from '../protocol/state-machine';
import { type PublishedRunEvent, publishRunEvent } from './run-events';

/**
 * Persistence for ACP runs. Every query is scoped by `teamId` so a run ID from
 * another tenant is indistinguishable from a missing one.
 */

type CreateRunOptions = {
  principal: AcpPrincipal;
  agentName: string;
  input: TMessage[];
  sessionId?: string | null;
  idempotencyKey?: string | null;
};

export const createRun = async ({ principal, agentName, input, sessionId, idempotencyKey }: CreateRunOptions) => {
  return await prisma.acpRun.create({
    data: {
      id: randomUUID(),
      agentName,
      status: AcpRunStatus.CREATED,
      sessionId: sessionId ?? null,
      idempotencyKey: idempotencyKey ?? null,
      input: input as unknown as Prisma.InputJsonValue,
      output: [] as unknown as Prisma.InputJsonValue,
      userId: principal.user.id,
      teamId: principal.teamId,
      apiTokenId: principal.apiTokenId,
    },
  });
};

type RunScope = {
  runId: string;
  teamId: number;
};

export const findRun = async ({ runId, teamId }: RunScope) => {
  return await prisma.acpRun.findFirst({
    where: {
      id: runId,
      teamId,
    },
  });
};

export const getRunOrThrow = async (scope: RunScope) => {
  const run = await findRun(scope);

  if (!run) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: `Run ${scope.runId} not found`,
      statusCode: 404,
    });
  }

  return run;
};

export const findRunByIdempotencyKey = async ({
  teamId,
  idempotencyKey,
}: {
  teamId: number;
  idempotencyKey: string;
}) => {
  return await prisma.acpRun.findUnique({
    where: {
      teamId_idempotencyKey: {
        teamId,
        idempotencyKey,
      },
    },
  });
};

type UpdateRunData = {
  status?: TRunStatus;
  output?: TMessage[];
  state?: unknown;
  awaitRequest?: TAwaitRequest | null;
  awaitResume?: TAwaitResume | null;
  error?: TAcpError | null;
  finishedAt?: Date | null;
};

const toJson = (value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull => {
  if (value === null) {
    return Prisma.JsonNull;
  }

  return value as Prisma.InputJsonValue;
};

export const updateRun = async ({ runId, teamId }: RunScope, data: UpdateRunData) => {
  return await prisma.acpRun.update({
    where: {
      id: runId,
      teamId,
    },
    data: {
      status: data.status ? toPrismaRunStatus(data.status) : undefined,
      output: data.output !== undefined ? (data.output as unknown as Prisma.InputJsonValue) : undefined,
      state: data.state !== undefined ? toJson(data.state) : undefined,
      awaitRequest: data.awaitRequest !== undefined ? toJson(data.awaitRequest) : undefined,
      awaitResume: data.awaitResume !== undefined ? toJson(data.awaitResume) : undefined,
      error: data.error !== undefined ? toJson(data.error) : undefined,
      finishedAt: data.finishedAt,
    },
  });
};

/**
 * Append an event to the run's durable log and broadcast it to live
 * subscribers. Sequence numbers are per run and start at 1.
 */
export const appendRunEvent = async (runId: string, event: TEvent): Promise<PublishedRunEvent> => {
  const created = await prisma.$transaction(async (tx) => {
    const last = await tx.acpRunEvent.aggregate({
      where: { runId },
      _max: { sequence: true },
    });

    const sequence = (last._max.sequence ?? 0) + 1;

    return await tx.acpRunEvent.create({
      data: {
        runId,
        sequence,
        type: event.type,
        payload: event as unknown as Prisma.InputJsonValue,
      },
    });
  });

  const published: PublishedRunEvent = { ...event, sequence: created.sequence };

  publishRunEvent(runId, published);

  return published;
};

export const listRunEvents = async ({ runId, teamId }: RunScope, afterSequence = 0): Promise<PublishedRunEvent[]> => {
  const events = await prisma.acpRunEvent.findMany({
    where: {
      runId,
      sequence: { gt: afterSequence },
      run: { teamId },
    },
    orderBy: { sequence: 'asc' },
  });

  return events.map(toPublishedEvent);
};

export const countRunEvents = async ({ runId, teamId }: RunScope): Promise<number> => {
  return await prisma.acpRunEvent.count({
    where: {
      runId,
      run: { teamId },
    },
  });
};

export const listSessionRuns = async ({ sessionId, teamId }: { sessionId: string; teamId: number }) => {
  return await prisma.acpRun.findMany({
    where: {
      sessionId,
      teamId,
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
};

/**
 * Runs left `IN_PROGRESS` or `CANCELLING` by a previous process can never
 * finish, because execution is in-process. Mark them failed on boot so
 * clients waiting on them get a terminal state.
 */
export const markOrphanedRuns = async (): Promise<number> => {
  const result = await prisma.acpRun.updateMany({
    where: {
      status: { in: [AcpRunStatus.IN_PROGRESS, AcpRunStatus.CANCELLING] },
    },
    data: {
      status: AcpRunStatus.FAILED,
      finishedAt: new Date(),
      error: {
        code: 'server_error',
        message: 'Run was interrupted by a server restart',
        data: { code: 'RUN_INTERRUPTED' },
      },
    },
  });

  return result.count;
};

const toPublishedEvent = (event: AcpRunEvent): PublishedRunEvent => {
  return {
    ...(event.payload as unknown as TEvent),
    sequence: event.sequence,
  };
};

const parseJsonArray = <T>(value: unknown, parse: (item: unknown) => T): T[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(parse);
};

/**
 * Project a database row onto the ACP `Run` wire shape.
 */
export const toAcpRun = (run: AcpRun): TRun => {
  const awaitRequest = run.awaitRequest ? ZAwaitRequestSchema.safeParse(run.awaitRequest) : null;
  const error = run.error ? ZAcpErrorSchema.safeParse(run.error) : null;

  return {
    agent_name: run.agentName,
    run_id: run.id,
    session_id: run.sessionId ?? null,
    status: fromPrismaRunStatus(run.status),
    await_request: awaitRequest?.success ? awaitRequest.data : null,
    output: parseJsonArray(run.output, (item) => ZMessageSchema.parse(item)),
    error: error?.success ? error.data : null,
    created_at: run.createdAt.toISOString(),
    finished_at: run.finishedAt ? run.finishedAt.toISOString() : null,
  };
};

export const getRunInput = (run: AcpRun): TMessage[] => parseJsonArray(run.input, (item) => ZMessageSchema.parse(item));

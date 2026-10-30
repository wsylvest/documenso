import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import type { AcpRun } from '@prisma/client';
import type { Logger } from 'pino';

import { getAgentOrThrow } from '../agents/registry';
import type { AcpPrincipal } from '../agents/types';
import type { TAwaitResume, TMessage, TRun, TSession } from '../protocol/schemas';
import { ZAwaitRequestSchema } from '../protocol/schemas';
import { fromPrismaRunStatus, isTerminalRunStatus } from '../protocol/state-machine';
import { getAcpBaseUrl, getAcpSyncTimeoutMs } from '../server/config';
import { waitForRunSettled } from './run-events';
import { abortActiveRun, executeRun, isRunActive, transitionRun } from './run-executor';
import {
  appendRunEvent,
  createRun,
  findRunByIdempotencyKey,
  getRunOrThrow,
  listSessionRuns,
  toAcpRun,
} from './run-store';

/**
 * Orchestration shared by the ACP REST routes and the A2A JSON-RPC binding.
 */

type StartRunOptions = {
  principal: AcpPrincipal;
  logger: Logger;
  agentName: string;
  input: TMessage[];
  sessionId?: string | null;
  idempotencyKey?: string | null;
};

export type StartedRun = {
  run: AcpRun;
  /**
   * Settles when the run pauses or finishes. Never rejects.
   */
  settled: Promise<void>;
  /**
   * True when an existing run was returned for a replayed idempotency key.
   */
  replayed: boolean;
};

export const startRun = async ({
  principal,
  logger,
  agentName,
  input,
  sessionId,
  idempotencyKey,
}: StartRunOptions): Promise<StartedRun> => {
  const agent = getAgentOrThrow(agentName);

  if (idempotencyKey) {
    const existing = await findRunByIdempotencyKey({ teamId: principal.teamId, idempotencyKey });

    if (existing) {
      if (existing.agentName !== agentName) {
        throw new AppError(AppErrorCode.INVALID_REQUEST, {
          message: `Idempotency key was already used for agent "${existing.agentName}"`,
          statusCode: 409,
        });
      }

      logger.info({ msg: 'ACP run replayed from idempotency key', acpRunId: existing.id, acpAgent: agentName });

      return { run: existing, settled: Promise.resolve(), replayed: true };
    }
  }

  const run = await createRun({ principal, agentName, input, sessionId, idempotencyKey });

  logger.info({
    msg: 'ACP run created',
    acpRunId: run.id,
    acpAgent: agentName,
    sessionId: run.sessionId,
    userId: principal.user.id,
    teamId: principal.teamId,
    apiTokenId: principal.apiTokenId,
  });

  await appendRunEvent(run.id, { type: 'run.created', run: toAcpRun(run) });

  const settled = executeRun({ run, agent, principal, logger, resume: null });

  return { run, settled, replayed: false };
};

type ResumeRunOptions = {
  principal: AcpPrincipal;
  logger: Logger;
  runId: string;
  awaitResume: TAwaitResume;
};

export const resumeRun = async ({ principal, logger, runId, awaitResume }: ResumeRunOptions): Promise<StartedRun> => {
  const run = await getRunOrThrow({ runId, teamId: principal.teamId });

  if (fromPrismaRunStatus(run.status) !== 'awaiting') {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `Run ${runId} is not awaiting input`,
      statusCode: 409,
    });
  }

  const awaitRequest = ZAwaitRequestSchema.safeParse(run.awaitRequest);

  if (!awaitRequest.success) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `Run ${runId} has no await request`,
      statusCode: 409,
    });
  }

  if (awaitRequest.data.type !== awaitResume.type) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `Run ${runId} is expecting a resume of type "${awaitRequest.data.type}"`,
      statusCode: 409,
    });
  }

  const agent = getAgentOrThrow(run.agentName);

  logger.info({ msg: 'ACP run resumed', acpRunId: run.id, acpAgent: run.agentName, awaitType: awaitResume.type });

  const settled = executeRun({ run, agent, principal, logger, resume: awaitResume });

  return { run, settled, replayed: false };
};

type CancelRunOptions = {
  principal: AcpPrincipal;
  logger: Logger;
  runId: string;
};

export const cancelRun = async ({ principal, logger, runId }: CancelRunOptions): Promise<AcpRun> => {
  const { teamId } = principal;

  const run = await getRunOrThrow({ runId, teamId });
  const status = fromPrismaRunStatus(run.status);

  if (isTerminalRunStatus(status)) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `Run ${runId} is already ${status} and cannot be cancelled`,
      statusCode: 409,
    });
  }

  if (status === 'cancelling') {
    return run;
  }

  const cancelling = await transitionRun({ runId, teamId, to: 'cancelling', logger });

  // An actively executing step observes the abort signal and the executor
  // completes the transition to `cancelled`. Anything else can finish now.
  if (status === 'in-progress' && isRunActive(runId)) {
    abortActiveRun(runId);

    return cancelling;
  }

  return await transitionRun({ runId, teamId, to: 'cancelled', logger });
};

/**
 * Wait for a run to settle in `sync` mode and return its latest state.
 */
export const awaitRunForSync = async (started: StartedRun, teamId: number): Promise<TRun> => {
  if (!started.replayed) {
    await Promise.race([started.settled, waitForRunSettled(started.run.id, getAcpSyncTimeoutMs())]);
  }

  const latest = await getRunOrThrow({ runId: started.run.id, teamId });

  return toAcpRun(latest);
};

export const getSession = async ({ sessionId, teamId }: { sessionId: string; teamId: number }): Promise<TSession> => {
  const runs = await listSessionRuns({ sessionId, teamId });

  if (runs.length === 0) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: `Session ${sessionId} not found`,
      statusCode: 404,
    });
  }

  return {
    id: sessionId,
    history: runs.map((run) => `${getAcpBaseUrl()}/runs/${run.id}`),
    state: null,
  };
};

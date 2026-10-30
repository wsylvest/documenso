import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import type { AcpRun } from '@prisma/client';
import type { Logger } from 'pino';

import type { AcpPrincipal, AgentDefinition } from '../agents/types';
import { agentMessage, parseAgentInput } from '../protocol/messages';
import type { TAcpError, TAwaitResume, TRunStatus } from '../protocol/schemas';
import { assertTransition, fromPrismaRunStatus, runStatusToEventType } from '../protocol/state-machine';
import { toAcpError } from '../server/errors';
import { appendRunEvent, getRunInput, getRunOrThrow, toAcpRun, updateRun } from './run-store';

/**
 * Abort controllers for runs executing in this process, keyed by run ID.
 */
const activeRuns = new Map<string, AbortController>();

export const isRunActive = (runId: string): boolean => activeRuns.has(runId);

export const abortActiveRun = (runId: string): boolean => {
  const controller = activeRuns.get(runId);

  if (!controller) {
    return false;
  }

  controller.abort();

  return true;
};

type TransitionOptions = {
  runId: string;
  teamId: number;
  to: TRunStatus;
  logger: Logger;
  data?: Parameters<typeof updateRun>[1];
};

/**
 * Move a run to a new status, persist it, append the matching event and
 * broadcast it. Reads the current status first so concurrent cancels are
 * honoured.
 */
export const transitionRun = async ({ runId, teamId, to, logger, data = {} }: TransitionOptions) => {
  const current = await getRunOrThrow({ runId, teamId });
  const from = fromPrismaRunStatus(current.status);

  assertTransition(from, to);

  const isTerminal = to === 'completed' || to === 'failed' || to === 'cancelled';

  const updated = await updateRun(
    { runId, teamId },
    {
      ...data,
      status: to,
      finishedAt: isTerminal ? new Date() : undefined,
    },
  );

  logger.info({
    msg: 'ACP run transition',
    acpRunId: runId,
    acpAgent: updated.agentName,
    from,
    to,
  });

  const eventType = runStatusToEventType(to);

  if (eventType) {
    await appendRunEvent(runId, { type: eventType, run: toAcpRun(updated) });
  } else {
    await appendRunEvent(runId, { type: 'generic', generic: { status: to, run_id: runId } });
  }

  return updated;
};

type ExecuteRunOptions = {
  run: AcpRun;
  agent: AgentDefinition;
  principal: AcpPrincipal;
  logger: Logger;
  resume: TAwaitResume | null;
};

/**
 * Execute one agent step for a run. Returns a promise that settles when the
 * run reaches `awaiting` or a terminal state; callers decide whether to await
 * it (sync) or not (async/stream).
 */
export const executeRun = ({ run, agent, principal, logger, resume }: ExecuteRunOptions): Promise<void> => {
  const { id: runId, teamId } = run;

  const controller = new AbortController();

  activeRuns.set(runId, controller);

  const runLogger = logger.child({ acpRunId: runId, acpAgent: agent.name });

  const execute = async () => {
    try {
      await transitionRun({ runId, teamId, to: 'in-progress', logger: runLogger, data: { awaitResume: resume } });

      const messages = getRunInput(run);
      const input = parseAgentInput(messages, agent.inputSchema);

      const result = await agent.step({
        runId,
        principal,
        logger: runLogger,
        input,
        messages,
        state: run.state as unknown,
        resume,
        signal: controller.signal,
        progress: async (message, data) => {
          await appendRunEvent(runId, { type: 'generic', generic: { message, ...data } });
        },
      });

      if (controller.signal.aborted) {
        await transitionRun({ runId, teamId, to: 'cancelled', logger: runLogger });

        return;
      }

      if (result.type === 'awaiting') {
        await transitionRun({
          runId,
          teamId,
          to: 'awaiting',
          logger: runLogger,
          data: {
            awaitRequest: result.awaitRequest,
            awaitResume: null,
            state: result.state,
          },
        });

        return;
      }

      const message = agentMessage(agent.name, result.output);

      await appendRunEvent(runId, { type: 'message.created', message });

      for (const part of message.parts) {
        await appendRunEvent(runId, { type: 'message.part', part });
      }

      await appendRunEvent(runId, { type: 'message.completed', message });

      const current = await getRunOrThrow({ runId, teamId });
      const previousOutput = toAcpRun(current).output;

      await transitionRun({
        runId,
        teamId,
        to: 'completed',
        logger: runLogger,
        data: {
          output: [...previousOutput, message],
          awaitRequest: null,
          state: null,
        },
      });
    } catch (error) {
      await failRun({ runId, teamId, error, aborted: controller.signal.aborted, logger: runLogger });
    } finally {
      activeRuns.delete(runId);
    }
  };

  return execute();
};

type FailRunOptions = {
  runId: string;
  teamId: number;
  error: unknown;
  aborted: boolean;
  logger: Logger;
};

const failRun = async ({ runId, teamId, error, aborted, logger }: FailRunOptions) => {
  const acpError: TAcpError = toAcpError(error).body;

  if (aborted) {
    logger.info({ msg: 'ACP run cancelled during execution', acpRunId: runId });
  } else {
    logger.error({ msg: 'ACP run failed', acpRunId: runId, err: error, acpError });
  }

  try {
    const current = await getRunOrThrow({ runId, teamId });
    const status = fromPrismaRunStatus(current.status);

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      return;
    }

    if (aborted || status === 'cancelling') {
      // A run in `created` or `awaiting` cannot reach cancelled directly.
      if (status !== 'cancelling') {
        await transitionRun({ runId, teamId, to: 'cancelling', logger });
      }

      await transitionRun({ runId, teamId, to: 'cancelled', logger });

      return;
    }

    await transitionRun({
      runId,
      teamId,
      to: 'failed',
      logger,
      data: { error: acpError, awaitRequest: null },
    });

    await appendRunEvent(runId, { type: 'error', error: acpError });
  } catch (transitionError) {
    logger.error({ msg: 'ACP run could not be marked failed', acpRunId: runId, err: transitionError });

    if (!(transitionError instanceof AppError && transitionError.code === AppErrorCode.INVALID_REQUEST)) {
      throw transitionError;
    }
  }
};

import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { AcpRunStatus } from '@prisma/client';

import type { TEventType, TRunStatus } from './schemas';

/**
 * ACP run lifecycle.
 *
 * ```
 * created ──► in-progress ──► completed | failed
 *    │             │  ▲
 *    │             ▼  │ (resume)
 *    │          awaiting
 *    │             │
 *    └──────► cancelling ──► cancelled
 * ```
 */
export const RUN_STATUS_TRANSITIONS: Record<TRunStatus, readonly TRunStatus[]> = {
  created: ['in-progress', 'cancelling', 'failed'],
  'in-progress': ['awaiting', 'completed', 'failed', 'cancelling'],
  awaiting: ['in-progress', 'cancelling', 'failed'],
  cancelling: ['cancelled', 'failed'],
  cancelled: [],
  completed: [],
  failed: [],
};

export const TERMINAL_RUN_STATUSES: ReadonlySet<TRunStatus> = new Set(['completed', 'failed', 'cancelled']);

export const isTerminalRunStatus = (status: TRunStatus): boolean => TERMINAL_RUN_STATUSES.has(status);

export const canTransition = (from: TRunStatus, to: TRunStatus): boolean => {
  return RUN_STATUS_TRANSITIONS[from].includes(to);
};

/**
 * Throws a 409 `INVALID_REQUEST` when the transition is not allowed.
 */
export const assertTransition = (from: TRunStatus, to: TRunStatus): void => {
  if (!canTransition(from, to)) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `Run cannot transition from "${from}" to "${to}"`,
      statusCode: 409,
    });
  }
};

const RUN_STATUS_TO_PRISMA: Record<TRunStatus, AcpRunStatus> = {
  created: AcpRunStatus.CREATED,
  'in-progress': AcpRunStatus.IN_PROGRESS,
  awaiting: AcpRunStatus.AWAITING,
  cancelling: AcpRunStatus.CANCELLING,
  cancelled: AcpRunStatus.CANCELLED,
  completed: AcpRunStatus.COMPLETED,
  failed: AcpRunStatus.FAILED,
};

const PRISMA_TO_RUN_STATUS: Record<AcpRunStatus, TRunStatus> = {
  [AcpRunStatus.CREATED]: 'created',
  [AcpRunStatus.IN_PROGRESS]: 'in-progress',
  [AcpRunStatus.AWAITING]: 'awaiting',
  [AcpRunStatus.CANCELLING]: 'cancelling',
  [AcpRunStatus.CANCELLED]: 'cancelled',
  [AcpRunStatus.COMPLETED]: 'completed',
  [AcpRunStatus.FAILED]: 'failed',
};

export const toPrismaRunStatus = (status: TRunStatus): AcpRunStatus => RUN_STATUS_TO_PRISMA[status];

export const fromPrismaRunStatus = (status: AcpRunStatus): TRunStatus => PRISMA_TO_RUN_STATUS[status];

/**
 * The ACP event emitted when a run enters a status. `cancelling` has no event
 * in the specification, so a `generic` event is emitted for it instead.
 */
export const runStatusToEventType = (status: TRunStatus): Extract<TEventType, `run.${string}`> | null => {
  switch (status) {
    case 'created':
      return 'run.created';
    case 'in-progress':
      return 'run.in-progress';
    case 'awaiting':
      return 'run.awaiting';
    case 'completed':
      return 'run.completed';
    case 'failed':
      return 'run.failed';
    case 'cancelled':
      return 'run.cancelled';
    case 'cancelling':
      return null;
  }
};

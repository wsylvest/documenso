import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { AcpRunStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { ZRunStatusSchema } from './schemas';
import {
  assertTransition,
  canTransition,
  fromPrismaRunStatus,
  isTerminalRunStatus,
  RUN_STATUS_TRANSITIONS,
  runStatusToEventType,
  toPrismaRunStatus,
} from './state-machine';

describe('ACP run state machine', () => {
  it('covers every run status', () => {
    expect(Object.keys(RUN_STATUS_TRANSITIONS).sort()).toEqual([...ZRunStatusSchema.options].sort());
  });

  it('allows the happy path created -> in-progress -> completed', () => {
    expect(canTransition('created', 'in-progress')).toBe(true);
    expect(canTransition('in-progress', 'completed')).toBe(true);
  });

  it('allows the await/resume loop', () => {
    expect(canTransition('in-progress', 'awaiting')).toBe(true);
    expect(canTransition('awaiting', 'in-progress')).toBe(true);
    expect(canTransition('awaiting', 'cancelling')).toBe(true);
  });

  it('requires cancelling before cancelled', () => {
    expect(canTransition('in-progress', 'cancelled')).toBe(false);
    expect(canTransition('awaiting', 'cancelled')).toBe(false);
    expect(canTransition('cancelling', 'cancelled')).toBe(true);
  });

  it('never leaves a terminal status', () => {
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      expect(isTerminalRunStatus(status)).toBe(true);
      expect(RUN_STATUS_TRANSITIONS[status]).toEqual([]);
    }

    for (const status of ['created', 'in-progress', 'awaiting', 'cancelling'] as const) {
      expect(isTerminalRunStatus(status)).toBe(false);
    }
  });

  it('throws a 409 INVALID_REQUEST for an illegal transition', () => {
    expect(() => assertTransition('completed', 'in-progress')).toThrowError(AppError);

    try {
      assertTransition('created', 'completed');
    } catch (error) {
      const appError = AppError.parseError(error);

      expect(appError.code).toBe(AppErrorCode.INVALID_REQUEST);
      expect(appError.statusCode).toBe(409);
    }
  });

  it('round-trips every status through the Prisma enum', () => {
    for (const status of ZRunStatusSchema.options) {
      expect(fromPrismaRunStatus(toPrismaRunStatus(status))).toBe(status);
    }

    expect(toPrismaRunStatus('in-progress')).toBe(AcpRunStatus.IN_PROGRESS);
  });

  it('maps statuses to the ACP event names, with no event for cancelling', () => {
    expect(runStatusToEventType('created')).toBe('run.created');
    expect(runStatusToEventType('in-progress')).toBe('run.in-progress');
    expect(runStatusToEventType('awaiting')).toBe('run.awaiting');
    expect(runStatusToEventType('completed')).toBe('run.completed');
    expect(runStatusToEventType('failed')).toBe('run.failed');
    expect(runStatusToEventType('cancelled')).toBe('run.cancelled');
    expect(runStatusToEventType('cancelling')).toBeNull();
  });
});

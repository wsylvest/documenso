import { EventEmitter } from 'node:events';

import { STREAM_TERMINATING_EVENT_TYPES, type TEvent } from '../protocol/schemas';

export type PublishedRunEvent = TEvent & {
  sequence: number;
};

type RunEventListener = (event: PublishedRunEvent) => void;

/**
 * In-process pub/sub for run events.
 *
 * Runs execute in the web process (like the `local` jobs provider), so SSE
 * handlers can tail events directly. Swap this for Redis or Postgres
 * LISTEN/NOTIFY when the executor moves to a worker.
 */
const emitter = new EventEmitter();

emitter.setMaxListeners(0);

const channel = (runId: string) => `run:${runId}`;

export const publishRunEvent = (runId: string, event: PublishedRunEvent): void => {
  emitter.emit(channel(runId), event);
};

export const subscribeRunEvents = (runId: string, listener: RunEventListener): (() => void) => {
  emitter.on(channel(runId), listener);

  return () => {
    emitter.off(channel(runId), listener);
  };
};

/**
 * Resolve once the run emits an event that pauses or ends it, or after
 * `timeoutMs`. Used by `sync` mode.
 */
export const waitForRunSettled = (runId: string, timeoutMs: number): Promise<'settled' | 'timeout'> => {
  return new Promise((resolve) => {
    let unsubscribe = () => {};

    const timer = setTimeout(() => {
      unsubscribe();
      resolve('timeout');
    }, timeoutMs);

    unsubscribe = subscribeRunEvents(runId, (event) => {
      if (STREAM_TERMINATING_EVENT_TYPES.has(event.type)) {
        clearTimeout(timer);
        unsubscribe();
        resolve('settled');
      }
    });
  });
};

import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';

import { STREAM_TERMINATING_EVENT_TYPES } from '../protocol/schemas';
import { isTerminalRunStatus } from '../protocol/state-machine';
import { type PublishedRunEvent, subscribeRunEvents } from '../runs/run-events';
import { getRunOrThrow, listRunEvents, toAcpRun } from '../runs/run-store';

const HEARTBEAT_INTERVAL_MS = 15_000;

type StreamRunEventsOptions = {
  runId: string;
  teamId: number;
  /**
   * Replay persisted events with a sequence greater than this value.
   */
  afterSequence: number;
};

/**
 * Stream a run's events as Server-Sent Events.
 *
 * Subscribes to live events before replaying the persisted ones so nothing is
 * missed; `sequence` numbers de-duplicate the overlap. The stream closes once
 * the run pauses (`run.awaiting`) or ends.
 */
export const streamRunEvents = (c: Context, { runId, teamId, afterSequence }: StreamRunEventsOptions) => {
  c.header('X-Run-Id', runId);
  c.header('Cache-Control', 'no-cache, no-transform');
  c.header('X-Accel-Buffering', 'no');

  return streamSSE(c, async (stream) => {
    let lastSequence = afterSequence;
    let closed = false;

    const buffered: PublishedRunEvent[] = [];
    let replaying = true;

    const writeEvent = async (event: PublishedRunEvent) => {
      if (closed || event.sequence <= lastSequence) {
        return;
      }

      lastSequence = event.sequence;

      const { sequence, ...payload } = event;

      await stream.writeSSE({
        id: String(sequence),
        event: event.type,
        data: JSON.stringify(payload),
      });

      if (STREAM_TERMINATING_EVENT_TYPES.has(event.type)) {
        closed = true;
      }
    };

    const unsubscribe = subscribeRunEvents(runId, (event) => {
      if (replaying) {
        buffered.push(event);

        return;
      }

      void writeEvent(event);
    });

    const heartbeat = setInterval(() => {
      if (!closed) {
        void stream.write(': ping\n\n');
      }
    }, HEARTBEAT_INTERVAL_MS);

    stream.onAbort(() => {
      closed = true;
    });

    try {
      const persisted = await listRunEvents({ runId, teamId }, afterSequence);

      for (const event of persisted) {
        await writeEvent(event);
      }

      replaying = false;

      for (const event of buffered.sort((a, b) => a.sequence - b.sequence)) {
        await writeEvent(event);
      }

      // The run may have settled before any listener attached (for example a
      // fast agent or a replayed run) without a terminating event after
      // `afterSequence`; close instead of waiting on the heartbeat forever.
      if (!closed) {
        const run = await getRunOrThrow({ runId, teamId });
        const status = toAcpRun(run).status;

        if (isTerminalRunStatus(status) || status === 'awaiting') {
          closed = true;
        }
      }

      while (!closed) {
        await stream.sleep(250);
      }
    } finally {
      clearInterval(heartbeat);
      unsubscribe();
    }
  });
};

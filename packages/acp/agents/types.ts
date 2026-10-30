import type { ApiRequestMetadata } from '@documenso/lib/universal/extract-request-metadata';
import type { Logger } from 'pino';
import type { z } from 'zod';

import type { TAwaitRequest, TAwaitResume, TMessage, TMessagePart } from '../protocol/schemas';

/**
 * The authenticated caller of an ACP request, derived from an API token the
 * same way `authenticatedMiddleware` derives it for API V2.
 */
export type AcpPrincipal = {
  user: {
    id: number;
    name: string | null;
    email: string;
  };
  teamId: number;
  apiTokenId: number | null;
  metadata: ApiRequestMetadata;

  /**
   * Signer details forwarded via the `X-Signer-IP-Address` and
   * `X-Signer-User-Agent` headers of the request that created or resumed the
   * run. Unvalidated; `resolveSignerRequestMetadata` validates on use.
   */
  forwardedSigner?: {
    ipAddress?: string;
    userAgent?: string;
  };
};

export type AgentStepContext<TInput, TState> = {
  runId: string;
  principal: AcpPrincipal;
  logger: Logger;

  /**
   * The validated JSON input extracted from the run's input messages.
   */
  input: TInput;

  /**
   * The raw input messages, for agents that need non-JSON parts.
   */
  messages: TMessage[];

  /**
   * Agent-private state persisted when the previous step returned `awaiting`.
   * `null` on the first step.
   */
  state: TState | null;

  /**
   * The payload supplied by `POST /runs/{id}` when resuming. `null` on the
   * first step.
   */
  resume: TAwaitResume | null;

  /**
   * Aborted when the run is cancelled. Long steps should check it between
   * side effects.
   */
  signal: AbortSignal;

  /**
   * Emit a `generic` progress event to stream listeners.
   */
  progress: (message: string, data?: Record<string, unknown>) => Promise<void>;
};

export type AgentStepResult<TState> =
  | {
      type: 'completed';
      output: TMessagePart[];
    }
  | {
      type: 'awaiting';
      awaitRequest: TAwaitRequest;
      state: TState;
    };

export type AgentDefinition<TInput = unknown, TState = unknown> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput, z.ZodTypeDef, unknown>;
  inputContentTypes: string[];
  outputContentTypes: string[];
  metadata: {
    documentation?: string;
    tags: string[];
    capabilities: { name: string; description: string }[];
    awaitTypes?: string[];
  };
  step: (ctx: AgentStepContext<TInput, TState>) => Promise<AgentStepResult<TState>>;
};

/**
 * Identity helper that lets TypeScript infer the input and state types from
 * the definition literal.
 */
export const defineAgent = <TInput, TState>(definition: AgentDefinition<TInput, TState>) => definition;

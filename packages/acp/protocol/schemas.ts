import { z } from 'zod';

/**
 * Wire schemas for the Agent Communication Protocol (ACP).
 *
 * Mirrors `docs/spec/openapi.yaml` in `i-am-bee/acp` (main, 2025-08). Field
 * names are deliberately snake_case to match the protocol.
 */

/**
 * RFC 1123 label: lowercase alphanumerics and hyphens, 1-63 characters.
 */
export const ZAgentNameSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, 'Agent name must be an RFC 1123 label');

export const ZRunModeSchema = z.enum(['sync', 'async', 'stream']);

export const ZRunStatusSchema = z.enum([
  'created',
  'in-progress',
  'awaiting',
  'cancelling',
  'cancelled',
  'completed',
  'failed',
]);

export const ZMessageRoleSchema = z
  .string()
  .regex(/^(user|agent(\/[a-zA-Z0-9_-]+)?)$/, 'Role must be "user", "agent" or "agent/{name}"');

export const ZMessagePartSchema = z
  .object({
    name: z.string().max(255).optional(),
    content_type: z.string().max(255).default('text/plain'),
    content: z.string().optional(),
    content_encoding: z.enum(['plain', 'base64']).default('plain'),
    content_url: z.string().url().optional(),
    metadata: z.record(z.unknown()).nullish(),
  })
  .refine((part) => !(part.content !== undefined && part.content_url !== undefined), {
    message: 'content and content_url cannot both be present',
  });

export const ZMessageSchema = z.object({
  role: ZMessageRoleSchema,
  parts: z.array(ZMessagePartSchema).min(1),
  created_at: z.string().datetime({ offset: true }).optional(),
  completed_at: z.string().datetime({ offset: true }).optional(),
});

/**
 * Await payloads are free-form objects in the OpenAPI document; the reference
 * SDK uses `{ type: 'message', message }`. A `type` is required so the server
 * can verify that a resume answers the request it issued.
 */
export const ZAwaitRequestSchema = z
  .object({
    type: z.string().min(1).max(64),
  })
  .passthrough();

export const ZAwaitResumeSchema = z
  .object({
    type: z.string().min(1).max(64),
  })
  .passthrough();

export const ZAcpErrorCodeSchema = z.enum(['server_error', 'invalid_input', 'not_found']);

export const ZAcpErrorSchema = z.object({
  code: ZAcpErrorCodeSchema,
  message: z.string(),
  data: z.record(z.unknown()).nullish(),
});

export const ZSessionSchema = z.object({
  id: z.string().uuid(),
  history: z.array(z.string()).default([]),
  state: z.string().nullish(),
});

export const ZRunSchema = z.object({
  agent_name: ZAgentNameSchema,
  run_id: z.string().uuid(),
  session_id: z.string().uuid().nullish(),
  status: ZRunStatusSchema,
  await_request: ZAwaitRequestSchema.nullish(),
  output: z.array(ZMessageSchema),
  error: ZAcpErrorSchema.nullish(),
  created_at: z.string(),
  finished_at: z.string().nullish(),
});

export const ZRunCreateRequestSchema = z.object({
  agent_name: ZAgentNameSchema,
  input: z.array(ZMessageSchema).min(1),
  session_id: z.string().uuid().optional(),
  session: ZSessionSchema.partial({ history: true }).optional(),
  mode: ZRunModeSchema.default('sync'),
  /**
   * Non-standard: allows clients that cannot set the `Idempotency-Key` header
   * to supply the key in the body.
   */
  idempotency_key: z.string().min(1).max(255).optional(),
});

export const ZRunResumeRequestSchema = z.object({
  run_id: z.string().uuid().optional(),
  await_resume: ZAwaitResumeSchema,
  mode: ZRunModeSchema.default('sync'),
});

export const ZListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(10),
  offset: z.coerce.number().int().min(0).default(0),
});

export const ZAgentManifestMetadataSchema = z.object({
  annotations: z.record(z.unknown()).optional(),
  documentation: z.string().optional(),
  license: z.string().optional(),
  programming_language: z.string().optional(),
  natural_languages: z.array(z.string()).optional(),
  framework: z.string().optional(),
  capabilities: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
  domains: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  links: z.array(z.object({ type: z.string(), url: z.string() })).optional(),
});

export const ZAgentManifestSchema = z.object({
  name: ZAgentNameSchema,
  description: z.string(),
  input_content_types: z.array(z.string()).min(1),
  output_content_types: z.array(z.string()).min(1),
  metadata: ZAgentManifestMetadataSchema.optional(),
});

export const ZEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message.created'), message: ZMessageSchema }),
  z.object({ type: z.literal('message.part'), part: ZMessagePartSchema }),
  z.object({ type: z.literal('message.completed'), message: ZMessageSchema }),
  z.object({ type: z.literal('generic'), generic: z.record(z.unknown()) }),
  z.object({ type: z.literal('run.created'), run: ZRunSchema }),
  z.object({ type: z.literal('run.in-progress'), run: ZRunSchema }),
  z.object({ type: z.literal('run.awaiting'), run: ZRunSchema }),
  z.object({ type: z.literal('run.completed'), run: ZRunSchema }),
  z.object({ type: z.literal('run.failed'), run: ZRunSchema }),
  z.object({ type: z.literal('run.cancelled'), run: ZRunSchema }),
  z.object({ type: z.literal('error'), error: ZAcpErrorSchema }),
]);

export type TAgentName = z.infer<typeof ZAgentNameSchema>;
export type TRunMode = z.infer<typeof ZRunModeSchema>;
export type TRunStatus = z.infer<typeof ZRunStatusSchema>;
export type TMessagePart = z.infer<typeof ZMessagePartSchema>;
export type TMessagePartInput = z.input<typeof ZMessagePartSchema>;
export type TMessage = z.infer<typeof ZMessageSchema>;
export type TAwaitRequest = z.infer<typeof ZAwaitRequestSchema>;
export type TAwaitResume = z.infer<typeof ZAwaitResumeSchema>;
export type TAcpError = z.infer<typeof ZAcpErrorSchema>;
export type TAcpErrorCode = z.infer<typeof ZAcpErrorCodeSchema>;
export type TSession = z.infer<typeof ZSessionSchema>;
export type TRun = z.infer<typeof ZRunSchema>;
export type TRunCreateRequest = z.infer<typeof ZRunCreateRequestSchema>;
export type TRunResumeRequest = z.infer<typeof ZRunResumeRequestSchema>;
export type TAgentManifest = z.infer<typeof ZAgentManifestSchema>;
export type TEvent = z.infer<typeof ZEventSchema>;
export type TEventType = TEvent['type'];

/**
 * Events that end a stream: the run either needs input or has finished.
 */
export const STREAM_TERMINATING_EVENT_TYPES: ReadonlySet<TEventType> = new Set([
  'run.awaiting',
  'run.completed',
  'run.failed',
  'run.cancelled',
]);

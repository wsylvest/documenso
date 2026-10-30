import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  CallToolResult,
  ContentBlock,
  ServerNotification,
  ServerRequest,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';

import { logMcpToolCall, type McpAuditIdentifiers } from './audit';
import type { McpToolContext } from './context';
import { normaliseToolError, toJsonText, toolErrorResult } from './tool-result';

export type McpToolHandlerResult<TOutput> = {
  /**
   * Validated against `outputSchema` and returned as `structuredContent`.
   */
  structured: TOutput;

  /**
   * Human readable summary. Defaults to the JSON of `structured`.
   */
  text?: string;

  /**
   * Extra content blocks, e.g. `resource_link`s.
   */
  content?: ContentBlock[];
};

export type McpToolDefinition<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> = {
  name: string;
  title: string;
  description: string;
  inputSchema: TInput;
  outputSchema: TOutput;
  annotations: ToolAnnotations;

  /**
   * Identifiers to attach to the audit log entry for this call.
   */
  identifiers?: (input: z.output<TInput>) => McpAuditIdentifiers;

  handler: (input: z.output<TInput>) => Promise<McpToolHandlerResult<z.output<TOutput>>>;
};

/**
 * Register a tool with structured output, audit logging and error mapping.
 *
 * Every tool in this server goes through here so the behaviour (annotations,
 * `structuredContent`, `isError` results with `AppErrorCode`s, log entry per
 * call) is uniform.
 */
export const defineTool = <TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(
  server: McpServer,
  ctx: McpToolContext,
  definition: McpToolDefinition<TInput, TOutput>,
) => {
  const { name, title, description, inputSchema, outputSchema, annotations, identifiers, handler } = definition;

  const callback = async (
    input: z.output<TInput>,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  ): Promise<CallToolResult> => {
    const startedAt = Date.now();

    let auditIdentifiers: McpAuditIdentifiers | undefined;

    try {
      auditIdentifiers = identifiers?.(input);
    } catch {
      auditIdentifiers = undefined;
    }

    try {
      const result = await handler(input);

      logMcpToolCall({
        logger: ctx.logger,
        tool: name,
        auth: ctx.auth,
        identifiers: auditIdentifiers,
        outcome: 'ok',
        durationMs: Date.now() - startedAt,
        requestId: extra.requestId,
        sessionId: extra.sessionId ?? ctx.sessionId,
      });

      return {
        content: [
          {
            type: 'text',
            text: result.text ?? toJsonText(result.structured),
          },
          ...(result.content ?? []),
        ],
        structuredContent: result.structured as Record<string, unknown>,
      };
    } catch (error) {
      const toolError = normaliseToolError(error);

      logMcpToolCall({
        logger: ctx.logger,
        tool: name,
        auth: ctx.auth,
        identifiers: auditIdentifiers,
        outcome: 'error',
        code: toolError.code,
        durationMs: Date.now() - startedAt,
        requestId: extra.requestId,
        sessionId: extra.sessionId ?? ctx.sessionId,
      });

      // Unexpected failures are worth the stack trace; expected AppErrors are not.
      if (toolError.status >= 500) {
        ctx.logger.error({ msg: 'mcp.tool.unexpected', tool: name, err: error });
      }

      return toolErrorResult(toolError);
    }
  };

  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title,
        ...annotations,
      },
    },
    // The SDK's conditional callback type does not resolve for a generic schema
    // parameter; the shape is identical, so the cast is safe.
    callback as ToolCallback<TInput>,
  );
};

/**
 * Annotation presets. `title` is filled in by `defineTool`.
 */
export const TOOL_ANNOTATIONS = {
  readOnly: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  create: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  createOpenWorld: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  update: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  send: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  destructive: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} satisfies Record<string, ToolAnnotations>;

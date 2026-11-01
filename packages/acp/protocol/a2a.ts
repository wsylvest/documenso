import { z } from 'zod';

import { listAgents } from '../agents/registry';
import type { AgentDefinition } from '../agents/types';
import { A2A_PROTOCOL_VERSION, getAcpBaseUrl } from '../server/config';
import { JSON_CONTENT_TYPE, TEXT_CONTENT_TYPE } from './messages';
import type { TMessage, TMessagePart, TRun, TRunStatus } from './schemas';

/**
 * Agent2Agent (A2A) 1.0 mapping over the ACP run core.
 *
 * Verified against https://a2a-protocol.org/latest/specification/ on
 * 2026-10-30: Agent Card at `/.well-known/agent-card.json`, PascalCase
 * JSON-RPC methods, `Part` with exactly one of text | raw | url | data.
 */

export const A2A_TASK_STATES = {
  submitted: 'TASK_STATE_SUBMITTED',
  working: 'TASK_STATE_WORKING',
  inputRequired: 'TASK_STATE_INPUT_REQUIRED',
  completed: 'TASK_STATE_COMPLETED',
  failed: 'TASK_STATE_FAILED',
  canceled: 'TASK_STATE_CANCELED',
} as const;

export type TA2aTaskState = (typeof A2A_TASK_STATES)[keyof typeof A2A_TASK_STATES];

export const runStatusToTaskState = (status: TRunStatus): TA2aTaskState => {
  switch (status) {
    case 'created':
      return A2A_TASK_STATES.submitted;
    case 'in-progress':
    case 'cancelling':
      return A2A_TASK_STATES.working;
    case 'awaiting':
      return A2A_TASK_STATES.inputRequired;
    case 'completed':
      return A2A_TASK_STATES.completed;
    case 'failed':
      return A2A_TASK_STATES.failed;
    case 'cancelled':
      return A2A_TASK_STATES.canceled;
  }
};

export const ZA2aPartSchema = z
  .object({
    text: z.string().optional(),
    raw: z.string().optional(),
    url: z.string().url().optional(),
    data: z.unknown().optional(),
    mediaType: z.string().optional(),
    filename: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine(
    (part) => [part.text, part.raw, part.url, part.data].filter((value) => value !== undefined).length === 1,
    'Exactly one of text, raw, url or data must be set',
  );

export const ZA2aMessageSchema = z.object({
  messageId: z.string().optional(),
  role: z.enum(['ROLE_USER', 'ROLE_AGENT', 'user', 'agent']).default('ROLE_USER'),
  parts: z.array(ZA2aPartSchema).min(1),
  taskId: z.string().uuid().optional(),
  contextId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const ZA2aSendMessageParamsSchema = z.object({
  message: ZA2aMessageSchema,
  configuration: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const ZA2aTaskIdParamsSchema = z.object({
  id: z.string().uuid(),
  historyLength: z.number().int().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const ZJsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

export type TJsonRpcRequest = z.infer<typeof ZJsonRpcRequestSchema>;

export const JSON_RPC_ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  taskNotFound: -32001,
  taskNotCancelable: -32002,
  unsupportedOperation: -32004,
} as const;

/**
 * 1.0 PascalCase names plus the 0.x slash-style aliases.
 */
export const A2A_METHOD_ALIASES: Record<string, 'SendMessage' | 'GetTask' | 'CancelTask'> = {
  SendMessage: 'SendMessage',
  'message/send': 'SendMessage',
  GetTask: 'GetTask',
  'tasks/get': 'GetTask',
  CancelTask: 'CancelTask',
  'tasks/cancel': 'CancelTask',
};

export const A2A_SKILL_METADATA_KEYS = ['skill', 'skillId', 'agent', 'agent_name'] as const;

export const a2aPartToAcpPart = (part: z.infer<typeof ZA2aPartSchema>): TMessagePart => {
  if (part.text !== undefined) {
    return {
      name: part.filename,
      content_type: part.mediaType ?? TEXT_CONTENT_TYPE,
      content: part.text,
      content_encoding: 'plain',
      metadata: part.metadata ?? null,
    };
  }

  if (part.data !== undefined) {
    return {
      name: part.filename ?? 'data',
      content_type: JSON_CONTENT_TYPE,
      content: JSON.stringify(part.data),
      content_encoding: 'plain',
      metadata: part.metadata ?? null,
    };
  }

  if (part.raw !== undefined) {
    return {
      name: part.filename,
      content_type: part.mediaType ?? 'application/octet-stream',
      content: part.raw,
      content_encoding: 'base64',
      metadata: part.metadata ?? null,
    };
  }

  return {
    name: part.filename,
    content_type: part.mediaType ?? 'application/octet-stream',
    content_url: part.url,
    content_encoding: 'plain',
    metadata: part.metadata ?? null,
  };
};

export const acpPartToA2aPart = (part: TMessagePart) => {
  const base = {
    filename: part.name,
    mediaType: part.content_type,
    metadata: part.metadata ?? undefined,
  };

  if (part.content_url !== undefined) {
    return { ...base, url: part.content_url };
  }

  if (part.content_encoding === 'base64') {
    return { ...base, raw: part.content ?? '' };
  }

  if (part.content_type === JSON_CONTENT_TYPE || part.content_type.endsWith('+json')) {
    try {
      return { ...base, data: JSON.parse(part.content ?? 'null') as unknown };
    } catch {
      return { ...base, text: part.content ?? '' };
    }
  }

  return { ...base, text: part.content ?? '' };
};

export const acpMessageToA2aMessage = (message: TMessage, taskId: string, contextId: string | null) => ({
  messageId: `${taskId}:${message.created_at ?? 'input'}`,
  role: message.role.startsWith('agent') ? 'ROLE_AGENT' : 'ROLE_USER',
  parts: message.parts.map(acpPartToA2aPart),
  taskId,
  contextId: contextId ?? undefined,
});

/**
 * Convert an A2A `SendMessage` message into the ACP agent name and input.
 * The skill (agent) is read from `message.metadata`; when absent and the
 * server exposes a single agent, that agent is used.
 */
export const a2aMessageToAcpInput = (message: z.infer<typeof ZA2aMessageSchema>, agents: AgentDefinition[]) => {
  const metadata = message.metadata ?? {};

  const skill = A2A_SKILL_METADATA_KEYS.map((key) => metadata[key]).find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );

  const agentName = skill ?? (agents.length === 1 ? agents[0].name : undefined);

  const input: TMessage[] = [
    {
      role: 'user',
      parts: message.parts.map(a2aPartToAcpPart),
      created_at: new Date().toISOString(),
    },
  ];

  return { agentName, input, taskId: message.taskId, contextId: message.contextId };
};

/**
 * Project an ACP run onto an A2A `Task`.
 */
export const acpRunToA2aTask = (run: TRun, input: TMessage[]) => {
  const state = runStatusToTaskState(run.status);

  const statusMessage =
    run.status === 'awaiting' && run.await_request && 'message' in run.await_request
      ? run.await_request.message
      : run.status === 'failed' && run.error
        ? {
            role: 'agent',
            parts: [
              { content_type: TEXT_CONTENT_TYPE, content: run.error.message, content_encoding: 'plain' as const },
            ],
          }
        : null;

  return {
    id: run.run_id,
    contextId: run.session_id ?? run.run_id,
    status: {
      state,
      timestamp: run.finished_at ?? run.created_at,
      message: statusMessage
        ? acpMessageToA2aMessage(statusMessage as TMessage, run.run_id, run.session_id ?? null)
        : undefined,
    },
    artifacts: run.output.map((message, index) => ({
      artifactId: `${run.run_id}:${index}`,
      name: run.agent_name,
      parts: message.parts.map(acpPartToA2aPart),
    })),
    history: [...input, ...run.output].map((message) =>
      acpMessageToA2aMessage(message, run.run_id, run.session_id ?? null),
    ),
    metadata: {
      acp_agent_name: run.agent_name,
      acp_status: run.status,
      acp_await_request: run.await_request ?? undefined,
    },
  };
};

type BuildAgentCardOptions = {
  webAppUrl: string;
  version: string;
};

/**
 * The A2A Agent Card served at `/.well-known/agent-card.json`. Contains only
 * static manifest data; nothing tenant specific.
 */
export const buildAgentCard = ({ webAppUrl, version }: BuildAgentCardOptions) => {
  const agents = listAgents();

  return {
    name: 'SR Sign',
    description:
      'Document signing agents: create and send envelopes, report signing status, retrieve sealed documents, ' +
      'certificates and audit logs, and drive recipient signing with human-in-the-loop confirmation.',
    version,
    supportedInterfaces: [
      {
        url: `${getAcpBaseUrl()}/a2a`,
        protocolBinding: 'JSONRPC',
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ],
    provider: {
      organization: 'SmartRoofing AI',
      url: webAppUrl,
    },
    documentationUrl: 'https://github.com/wsylvest/documenso/blob/main/apps/docs/content/docs/developers/acp.mdx',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
      extensions: [
        {
          uri: 'https://agentcommunicationprotocol.dev',
          description: `ACP REST interface at ${getAcpBaseUrl()} (same agents, same run identifiers).`,
          required: false,
        },
      ],
    },
    securitySchemes: {
      apiToken: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'api_...',
        description: 'SR Sign API token. Create one under Team settings > API Tokens.',
      },
    },
    security: [{ apiToken: [] }],
    defaultInputModes: [JSON_CONTENT_TYPE, TEXT_CONTENT_TYPE],
    defaultOutputModes: [JSON_CONTENT_TYPE, TEXT_CONTENT_TYPE],
    skills: agents.map((agent) => ({
      id: agent.name,
      name: agent.name,
      description: agent.description,
      tags: agent.metadata.tags,
      inputModes: agent.inputContentTypes,
      outputModes: agent.outputContentTypes,
      examples: [`Set message.metadata.skill = "${agent.name}" and send a data part matching the ACP input schema.`],
    })),
  };
};

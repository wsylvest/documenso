import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { zodToJsonSchema } from 'zod-to-json-schema';

import type { TAgentManifest } from '../protocol/schemas';
import { getAcpBaseUrl } from '../server/config';
import { documentRetrievalAgent } from './document-retrieval';
import { envelopeSenderAgent } from './envelope-sender';
import { recipientSignerAgent } from './recipient-signer';
import { signingStatusAgent } from './signing-status';
import type { AgentDefinition } from './types';

/**
 * Ordered list of agents exposed at `GET /agents`.
 */
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous agent input/state types are erased at the registry boundary.
export const ACP_AGENTS: AgentDefinition<any, any>[] = [
  envelopeSenderAgent,
  signingStatusAgent,
  documentRetrievalAgent,
  recipientSignerAgent,
];

export const listAgents = (): AgentDefinition[] => ACP_AGENTS;

export const findAgent = (name: string): AgentDefinition | undefined => {
  return ACP_AGENTS.find((agent) => agent.name === name);
};

export const getAgentOrThrow = (name: string): AgentDefinition => {
  const agent = findAgent(name);

  if (!agent) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: `Agent "${name}" not found`,
      statusCode: 404,
    });
  }

  return agent;
};

const manifestCache = new Map<string, TAgentManifest>();

/**
 * Project an agent definition onto the ACP `AgentManifest`. The JSON Schema of
 * the input lives in `metadata.annotations.input_schema` so tool-calling
 * clients can build requests without reading the docs.
 */
export const toAgentManifest = (agent: AgentDefinition): TAgentManifest => {
  const cached = manifestCache.get(agent.name);

  if (cached) {
    return cached;
  }

  const manifest: TAgentManifest = {
    name: agent.name,
    description: agent.description,
    input_content_types: agent.inputContentTypes,
    output_content_types: agent.outputContentTypes,
    metadata: {
      framework: 'sr-sign',
      programming_language: 'TypeScript',
      natural_languages: ['en'],
      documentation:
        agent.metadata.documentation ??
        'https://github.com/wsylvest/documenso/blob/main/apps/docs/content/docs/developers/acp.mdx',
      tags: agent.metadata.tags,
      capabilities: agent.metadata.capabilities,
      domains: ['document-signing'],
      links: [{ type: 'source-code', url: `${getAcpBaseUrl()}/agents/${agent.name}` }],
      annotations: {
        input_schema: zodToJsonSchema(agent.inputSchema, { $refStrategy: 'none' }),
        await_types: agent.metadata.awaitTypes ?? [],
      },
    },
  };

  manifestCache.set(agent.name, manifest);

  return manifest;
};

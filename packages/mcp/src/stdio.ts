/**
 * stdio entry point.
 *
 * Runs as a local process for MCP clients that only support stdio servers and
 * proxies every request to the remote Streamable HTTP endpoint (`/api/mcp`) of
 * a Documenso instance, authenticating with an API token. Nothing touches the
 * database locally, so this can run on any laptop with Node.js.
 *
 *   DOCUMENSO_URL=https://sign.smartroofing.ai \
 *   DOCUMENSO_API_TOKEN=api_xxx \
 *   npx documenso-mcp
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  CompleteRequestSchema,
  CompleteResultSchema,
  GetPromptRequestSchema,
  GetPromptResultSchema,
  ListPromptsRequestSchema,
  ListPromptsResultSchema,
  ListResourcesRequestSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesRequestSchema,
  ListResourceTemplatesResultSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  PromptListChangedNotificationSchema,
  ReadResourceRequestSchema,
  ReadResourceResultSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { MCP_PATH, MCP_SERVER_NAME, MCP_SERVER_VERSION } from './constants';

const log = (message: string) => {
  // stdout is the protocol channel; diagnostics go to stderr.
  process.stderr.write(`[documenso-mcp] ${message}\n`);
};

const readConfig = () => {
  const baseUrl = (process.env.DOCUMENSO_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const apiToken = process.env.DOCUMENSO_API_TOKEN;

  if (!apiToken) {
    log('DOCUMENSO_API_TOKEN is required (a team API token, e.g. api_xxx).');
    process.exit(2);
  }

  return {
    endpoint: new URL(`${baseUrl}${MCP_PATH}`),
    apiToken,
  };
};

export const startStdioProxy = async () => {
  const { endpoint, apiToken } = readConfig();

  const remote = new Client({ name: `${MCP_SERVER_NAME}-stdio`, version: MCP_SERVER_VERSION });

  const remoteTransport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    },
  });

  await remote.connect(remoteTransport);

  const remoteInfo = remote.getServerVersion();
  const remoteCapabilities = remote.getServerCapabilities() ?? {};

  log(`Connected to ${endpoint.href} (${remoteInfo?.name ?? 'unknown'} ${remoteInfo?.version ?? ''})`);

  const local = new Server(
    {
      name: remoteInfo?.name ?? MCP_SERVER_NAME,
      title: remoteInfo?.title,
      version: remoteInfo?.version ?? MCP_SERVER_VERSION,
    },
    {
      capabilities: remoteCapabilities,
      instructions: remote.getInstructions(),
    },
  );

  // Forward every supported request type verbatim; the remote validates and
  // produces the result, errors come back as JSON-RPC errors unchanged.
  local.setRequestHandler(ListToolsRequestSchema, async (request) => remote.request(request, ListToolsResultSchema));
  local.setRequestHandler(CallToolRequestSchema, async (request) => remote.request(request, CallToolResultSchema));
  local.setRequestHandler(ListResourcesRequestSchema, async (request) =>
    remote.request(request, ListResourcesResultSchema),
  );
  local.setRequestHandler(ListResourceTemplatesRequestSchema, async (request) =>
    remote.request(request, ListResourceTemplatesResultSchema),
  );
  local.setRequestHandler(ReadResourceRequestSchema, async (request) =>
    remote.request(request, ReadResourceResultSchema),
  );
  local.setRequestHandler(ListPromptsRequestSchema, async (request) =>
    remote.request(request, ListPromptsResultSchema),
  );
  local.setRequestHandler(GetPromptRequestSchema, async (request) => remote.request(request, GetPromptResultSchema));
  local.setRequestHandler(CompleteRequestSchema, async (request) => remote.request(request, CompleteResultSchema));

  remote.setNotificationHandler(ToolListChangedNotificationSchema, async () => local.sendToolListChanged());
  remote.setNotificationHandler(ResourceListChangedNotificationSchema, async () => local.sendResourceListChanged());
  remote.setNotificationHandler(PromptListChangedNotificationSchema, async () => local.sendPromptListChanged());

  remote.onclose = () => {
    log('Remote connection closed');
    void local.close();
  };

  const localTransport = new StdioServerTransport();

  localTransport.onclose = () => {
    void remote.close();
  };

  await local.connect(localTransport);
};

startStdioProxy().catch((error: unknown) => {
  log(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

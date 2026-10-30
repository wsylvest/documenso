import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { prisma } from '@documenso/prisma';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { DocumentStatus, EnvelopeType } from '@prisma/client';

import { apiCreateTestContext, apiSeedTemplate } from '../../fixtures/api-seeds';

/**
 * These tests need `NEXT_PUBLIC_MCP_ENABLED=true` on the server under test.
 */

const WEBAPP_BASE_URL = NEXT_PUBLIC_WEBAPP_URL();
const MCP_URL = `${WEBAPP_BASE_URL}/api/mcp`;
const PROTOCOL_VERSION = '2025-06-18';

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

const mcpHeaders = (apiToken?: string, sessionId?: string) => ({
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  'MCP-Protocol-Version': PROTOCOL_VERSION,
  ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
  ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
});

let nextId = 1;

const rpc = async (
  request: APIRequestContext,
  apiToken: string | undefined,
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
): Promise<{ response: APIResponse; body: JsonRpcResponse }> => {
  const response = await request.post(MCP_URL, {
    headers: mcpHeaders(apiToken, sessionId),
    data: {
      jsonrpc: '2.0',
      id: nextId++,
      method,
      params,
    },
  });

  const text = await response.text();

  // The server answers with JSON (enableJsonResponse) but tolerate SSE framing
  // in case the transport configuration changes.
  const payload =
    text.startsWith('event:') || text.startsWith('data:')
      ? text
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('')
      : text;

  return { response, body: JSON.parse(payload) as JsonRpcResponse };
};

const initialise = async (request: APIRequestContext, apiToken: string) => {
  const { response, body } = await rpc(request, apiToken, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'playwright', version: '1.0.0' },
  });

  expect(response.status(), JSON.stringify(body)).toBe(200);
  expect(body.error).toBeUndefined();

  const sessionId = response.headers()['mcp-session-id'];

  // Stateless servers never issue a session id; stateful ones always do.
  const initialised = await request.post(MCP_URL, {
    headers: mcpHeaders(apiToken, sessionId),
    data: { jsonrpc: '2.0', method: 'notifications/initialized' },
  });

  expect(initialised.status()).toBe(202);

  return { result: body.result as { serverInfo: { name: string }; capabilities: Record<string, unknown> }, sessionId };
};

test.describe('MCP server', () => {
  test('serves RFC 9728 protected resource metadata and challenges unauthenticated requests', async ({ request }) => {
    const metadataResponse = await request.get(`${WEBAPP_BASE_URL}/.well-known/oauth-protected-resource/api/mcp`);

    expect(metadataResponse.status()).toBe(200);

    const metadata = await metadataResponse.json();

    expect(metadata.resource).toBe(MCP_URL);
    expect(metadata.bearer_methods_supported).toEqual(['header']);
    expect(Array.isArray(metadata.authorization_servers)).toBe(true);

    const bareMetadata = await request.get(`${WEBAPP_BASE_URL}/.well-known/oauth-protected-resource`);

    expect(bareMetadata.status()).toBe(200);

    const { response: noToken } = await rpc(request, undefined, 'initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'playwright', version: '1.0.0' },
    });

    expect(noToken.status()).toBe(401);
    expect(noToken.headers()['www-authenticate']).toContain('Bearer');
    expect(noToken.headers()['www-authenticate']).toContain(
      `resource_metadata="${WEBAPP_BASE_URL}/.well-known/oauth-protected-resource/api/mcp"`,
    );

    const { response: badToken } = await rpc(request, 'api_invalid', 'initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'playwright', version: '1.0.0' },
    });

    expect(badToken.status()).toBe(401);
    expect(badToken.headers()['www-authenticate']).toContain('error="invalid_token"');
  });

  test('rejects browser requests from unknown origins', async ({ request }) => {
    const { token } = await apiCreateTestContext('mcp-origin');

    const response = await request.post(MCP_URL, {
      headers: { ...mcpHeaders(token), Origin: 'https://evil.example.com' },
      data: { jsonrpc: '2.0', id: 1, method: 'ping' },
    });

    expect(response.status()).toBe(403);
  });

  test('initialises, lists tools, calls a read-only tool and creates a document from a template', async ({
    request,
  }) => {
    const seeded = await apiSeedTemplate(request, {
      title: '[TEST] MCP Template',
      recipients: [{ email: 'placeholder@test.documenso.com', name: 'Placeholder', role: 'SIGNER' }],
      fieldsPerRecipient: [[{ type: 'SIGNATURE', page: 1, positionX: 5, positionY: 5, width: 15, height: 5 }]],
    });

    const apiToken = seeded.token;

    const { result: initResult, sessionId } = await initialise(request, apiToken);

    expect(initResult.serverInfo.name).toBe('documenso');
    expect(initResult.capabilities).toHaveProperty('tools');
    expect(initResult.capabilities).toHaveProperty('resources');
    expect(initResult.capabilities).toHaveProperty('prompts');

    // tools/list
    const { body: toolsBody } = await rpc(request, apiToken, 'tools/list', {}, sessionId);

    const tools = (toolsBody.result?.tools ?? []) as Array<{
      name: string;
      annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
    }>;

    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        'list_templates',
        'get_template',
        'create_document_from_template',
        'list_envelopes',
        'get_envelope',
        'distribute_envelope',
        'resend_envelope',
        'download_envelope_pdf',
        'signing_get_envelope',
        'signing_consent',
        'signing_sign_field',
        'signing_complete',
        'signing_reject',
      ]),
    );

    expect(tools.find((tool) => tool.name === 'list_templates')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'delete_envelope')?.annotations?.destructiveHint).toBe(true);

    // Read-only tool: list_templates must only see this team's templates.
    const { body: listBody } = await rpc(
      request,
      apiToken,
      'tools/call',
      { name: 'list_templates', arguments: { query: 'MCP Template' } },
      sessionId,
    );

    expect(listBody.error, JSON.stringify(listBody)).toBeUndefined();

    const listResult = listBody.result as {
      isError?: boolean;
      structuredContent: { count: number; data: Array<{ id: string; title: string }> };
    };

    expect(listResult.isError).toBeFalsy();
    expect(listResult.structuredContent.data.map((template) => template.id)).toContain(seeded.envelope.id);

    // get_template exposes the placeholder recipient id needed for the create call.
    const { body: templateBody } = await rpc(
      request,
      apiToken,
      'tools/call',
      { name: 'get_template', arguments: { templateId: seeded.envelope.id } },
      sessionId,
    );

    const templateResult = templateBody.result as {
      structuredContent: { recipients: Array<{ id: number; email: string }> };
    };

    const placeholderRecipientId = templateResult.structuredContent.recipients[0].id;

    // Create tool: create_document_from_template as a draft (no emails).
    const { body: createBody } = await rpc(
      request,
      apiToken,
      'tools/call',
      {
        name: 'create_document_from_template',
        arguments: {
          templateId: seeded.envelope.id,
          title: '[TEST] MCP created document',
          recipients: [{ id: placeholderRecipientId, email: 'homeowner@test.documenso.com', name: 'Home Owner' }],
          distribute: false,
        },
      },
      sessionId,
    );

    expect(createBody.error, JSON.stringify(createBody)).toBeUndefined();

    const createResult = createBody.result as {
      isError?: boolean;
      structuredContent: { envelopeId: string; distributed: boolean };
    };

    expect(createResult.isError).toBeFalsy();
    expect(createResult.structuredContent.distributed).toBe(false);

    const created = await prisma.envelope.findUniqueOrThrow({
      where: { id: createResult.structuredContent.envelopeId },
      include: { recipients: true },
    });

    expect(created.type).toBe(EnvelopeType.DOCUMENT);
    expect(created.status).toBe(DocumentStatus.DRAFT);
    expect(created.teamId).toBe(seeded.team.id);
    expect(created.title).toBe('[TEST] MCP created document');
    expect(created.recipients.map((recipient) => recipient.email)).toContain('homeowner@test.documenso.com');

    // Destructive tools refuse to run without confirm: true.
    const { body: deleteBody } = await rpc(
      request,
      apiToken,
      'tools/call',
      { name: 'delete_envelope', arguments: { envelopeId: created.id } },
      sessionId,
    );

    const deleteResult = deleteBody.result as { isError?: boolean; content: Array<{ text?: string }> };

    expect(deleteResult.isError).toBe(true);
    expect(JSON.stringify(deleteResult.content)).toContain('confirm');

    const stillThere = await prisma.envelope.findUnique({ where: { id: created.id } });

    expect(stillThere?.deletedAt ?? null).toBeNull();

    // Another team's token cannot see the template.
    const other = await apiCreateTestContext('mcp-other-team');

    const { body: otherGet } = await rpc(request, other.token, 'tools/call', {
      name: 'get_template',
      arguments: { templateId: seeded.envelope.id },
    });

    const otherResult = otherGet.result as { isError?: boolean; _meta?: { error?: { code: string } } };

    expect(otherResult.isError).toBe(true);
    expect(otherResult._meta?.error?.code).toBe('NOT_FOUND');
  });
});

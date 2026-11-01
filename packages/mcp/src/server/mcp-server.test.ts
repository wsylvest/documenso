import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TRPCError } from '@trpc/server';
import pino from 'pino';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { McpAuth } from './auth/authenticate';
import type { McpCaller, McpToolContext } from './context';
import { createMcpServer } from './mcp-server';

const auth: McpAuth = {
  apiTokenId: 1,
  user: { id: 10, email: 'staff@smartroofing.ai', name: 'Staff' },
  teamId: 20,
  team: { id: 20, name: 'SmartRoofing AI', url: 'smartroofing', organisationId: 'org_1' },
};

const now = new Date('2026-10-30T10:00:00.000Z');

/**
 * Shaped like `ZEnvelopeManySchema`, which is what `envelope.find` returns after
 * tRPC output parsing.
 */
const templateSummary = {
  id: 'envelope_tpl',
  secondaryId: 'template_1',
  internalVersion: 2,
  type: 'TEMPLATE',
  status: 'DRAFT',
  source: 'TEMPLATE',
  visibility: 'EVERYONE',
  templateType: 'PRIVATE',
  externalId: null,
  createdAt: now,
  updatedAt: now,
  completedAt: null,
  deletedAt: null,
  title: 'Roofing contract',
  authOptions: null,
  formValues: null,
  publicTitle: '',
  publicDescription: '',
  userId: 10,
  teamId: 20,
  folderId: null,
  templateId: null,
  user: { id: 10, name: 'Staff', email: 'staff@smartroofing.ai' },
  recipients: [],
  team: { id: 20, url: 'smartroofing' },
};

const envelopeFind = vi.fn(async () => ({
  data: [templateSummary],
  count: 1,
  currentPage: 1,
  perPage: 10,
  totalPages: 1,
}));

const envelopeDelete = vi.fn(async () => {
  throw new TRPCError({
    code: 'NOT_FOUND',
    cause: new AppError(AppErrorCode.NOT_FOUND, { message: 'Envelope not found', statusCode: 404 }),
  });
});

const caller = {
  envelope: {
    find: envelopeFind,
    delete: envelopeDelete,
  },
} as unknown as McpCaller;

const ctx: McpToolContext = {
  auth,
  caller,
  logger: pino({ level: 'silent' }),
  requestMetadata: {},
  baseUrl: 'https://sign.smartroofing.ai',
};

const client = new Client({ name: 'test-client', version: '0.0.0' });

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  // The in-memory pair passes objects by reference. Round-trip through JSON so
  // the client sees what an HTTP client would (dates as strings, no undefined).
  const send = serverTransport.send.bind(serverTransport);

  serverTransport.send = async (message, options) => send(JSON.parse(JSON.stringify(message)), options);

  const server = createMcpServer(ctx);

  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

describe('createMcpServer', () => {
  it('lists every tool with annotations, input and output schemas', async () => {
    const { tools } = await client.listTools();

    const names = tools.map((tool) => tool.name);

    expect(names).toEqual([
      'list_teams',
      'list_folders',
      'list_templates',
      'get_template',
      'create_document_from_template',
      'list_envelopes',
      'get_envelope',
      'get_envelope_audit_logs',
      'update_envelope',
      'cancel_envelope',
      'delete_envelope',
      'create_envelope',
      'download_envelope_pdf',
      'download_certificate',
      'download_audit_log',
      'add_recipients',
      'update_recipients',
      'add_fields',
      'update_fields',
      'distribute_envelope',
      'resend_envelope',
      'signing_get_envelope',
      'signing_get_status',
      'signing_view',
      'signing_consent',
      'signing_sign_field',
      'signing_complete',
      'signing_reject',
    ]);

    for (const tool of tools) {
      expect(tool.annotations, tool.name).toBeDefined();
      expect(tool.annotations?.readOnlyHint, tool.name).toBeTypeOf('boolean');
      expect(tool.annotations?.destructiveHint, tool.name).toBeTypeOf('boolean');
      expect(tool.annotations?.idempotentHint, tool.name).toBeTypeOf('boolean');
      expect(tool.annotations?.openWorldHint, tool.name).toBeTypeOf('boolean');
      expect(tool.inputSchema.type, tool.name).toBe('object');
      expect(tool.outputSchema?.type, tool.name).toBe('object');
      expect(tool.description, tool.name).toBeTruthy();

      // An output schema that no value can satisfy (allOf of closed objects)
      // would make every successful call fail client-side validation.
      expect(JSON.stringify(tool.outputSchema), tool.name).not.toContain('"allOf"');
    }

    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    expect(byName.get('list_templates')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('delete_envelope')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('signing_reject')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('distribute_envelope')?.annotations?.openWorldHint).toBe(true);

    // Destructive tools require the literal `confirm: true`.
    const deleteSchema = byName.get('delete_envelope')?.inputSchema as { required?: string[] };

    expect(deleteSchema.required).toContain('confirm');
  });

  it('lists resource templates and prompts', async () => {
    const { resourceTemplates } = await client.listResourceTemplates();

    expect(resourceTemplates.map((template) => template.uriTemplate)).toEqual([
      'sr-sign://envelope/{envelopeId}',
      'sr-sign://template/{envelopeId}',
      'sr-sign://envelope/{envelopeId}/item/{envelopeItemId}/pdf{?version}',
      'sr-sign://envelope/{envelopeId}/certificate',
      'sr-sign://envelope/{envelopeId}/audit-log',
    ]);

    const { prompts } = await client.listPrompts();

    expect(prompts.map((prompt) => prompt.name)).toEqual([
      'send_contract_to_homeowner',
      'check_signing_progress',
      'chase_unsigned_recipients',
    ]);

    const prompt = await client.getPrompt({
      name: 'send_contract_to_homeowner',
      arguments: { homeownerName: 'Jane Doe', homeownerEmail: 'jane@example.com' },
    });

    expect(prompt.messages[0].content).toMatchObject({ type: 'text' });
    expect(JSON.stringify(prompt.messages[0].content)).toContain('jane@example.com');
  });

  it('calls a read-only tool through the caller and returns structured output', async () => {
    const result = await client.callTool({ name: 'list_templates', arguments: { query: 'roof' } });

    expect(envelopeFind).toHaveBeenCalledWith(expect.objectContaining({ query: 'roof', type: 'TEMPLATE' }));

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      count: 1,
      data: [{ id: 'envelope_tpl', title: 'Roofing contract', createdAt: now.toISOString() }],
    });
    expect(JSON.stringify(result.content)).toContain('Roofing contract');
  });

  it('lists templates as resources', async () => {
    const { resources } = await client.listResources();

    expect(resources).toEqual([
      expect.objectContaining({ uri: 'sr-sign://template/envelope_tpl', title: 'Roofing contract' }),
    ]);
  });

  it('rejects a destructive tool call without confirmation before reaching the caller', async () => {
    const result = await client.callTool({ name: 'delete_envelope', arguments: { envelopeId: 'envelope_x' } });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('confirm');
    expect(envelopeDelete).not.toHaveBeenCalled();
  });

  it('maps AppErrors thrown by procedures to isError results with the code', async () => {
    const result = await client.callTool({
      name: 'delete_envelope',
      arguments: { envelopeId: 'envelope_x', confirm: true },
    });

    expect(envelopeDelete).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result._meta).toEqual({ error: { code: 'NOT_FOUND', message: 'Envelope not found', status: 404 } });
    expect(JSON.stringify(result.content)).toContain('NOT_FOUND: Envelope not found');
  });
});

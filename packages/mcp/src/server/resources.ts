import { type McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { EnvelopeType } from '@prisma/client';

import type { McpToolContext } from './context';
import {
  buildEnvelopeUri,
  buildTemplateUri,
  type EnvelopePdfVersion,
  readAuditLogPdf,
  readCertificatePdf,
  readEnvelopeItemPdf,
  toBase64,
} from './files';
import { normaliseToolError } from './tool-result';

const TEMPLATE_LIST_LIMIT = 50;

const jsonResource = (uri: string, value: unknown): ReadResourceResult => ({
  contents: [
    {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(value, null, 2),
    },
  ],
});

const pdfResource = (uri: string, bytes: Uint8Array): ReadResourceResult => ({
  contents: [
    {
      uri,
      mimeType: 'application/pdf',
      blob: toBase64(bytes),
    },
  ],
});

const firstVariable = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * Resource reads surface failures as JSON-RPC errors. Rethrow with the stable
 * code and message so clients see `NOT_FOUND: ...` rather than a stack trace.
 */
const rethrowResourceError = (error: unknown): never => {
  const toolError = normaliseToolError(error);

  throw new Error(`${toolError.code}: ${toolError.message}`);
};

export const registerResources = (server: McpServer, ctx: McpToolContext) => {
  server.registerResource(
    'envelope',
    new ResourceTemplate('sr-sign://envelope/{envelopeId}', { list: undefined }),
    {
      title: 'Envelope',
      description: 'A document or template envelope as JSON, including recipients, fields and settings.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const envelopeId = firstVariable(variables.envelopeId) ?? '';

      try {
        const envelope = await ctx.caller.envelope.get({ envelopeId });

        return jsonResource(uri.href, envelope);
      } catch (error) {
        return rethrowResourceError(error);
      }
    },
  );

  server.registerResource(
    'template',
    new ResourceTemplate('sr-sign://template/{envelopeId}', {
      list: async () => {
        const result = await ctx.caller.envelope.find({
          type: EnvelopeType.TEMPLATE,
          perPage: TEMPLATE_LIST_LIMIT,
          orderByDirection: 'desc',
        });

        return {
          resources: result.data.map((template) => ({
            uri: buildTemplateUri(template.id),
            name: template.id,
            title: template.title,
            description: `Template ${template.title}`,
            mimeType: 'application/json',
          })),
        };
      },
    }),
    {
      title: 'Template',
      description: "One of the team's templates as JSON, including placeholder recipients and fields.",
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const envelopeId = firstVariable(variables.envelopeId) ?? '';

      try {
        const envelope = await ctx.caller.envelope.get({ envelopeId });

        if (envelope.type !== EnvelopeType.TEMPLATE) {
          throw new Error(`NOT_FOUND: ${envelopeId} is not a template. Read ${buildEnvelopeUri(envelopeId)} instead.`);
        }

        return jsonResource(uri.href, envelope);
      } catch (error) {
        return rethrowResourceError(error);
      }
    },
  );

  server.registerResource(
    'envelope-item-pdf',
    new ResourceTemplate('sr-sign://envelope/{envelopeId}/item/{envelopeItemId}/pdf{?version}', { list: undefined }),
    {
      title: 'Envelope item PDF',
      description:
        'The PDF of an envelope item. version=signed (default) is the sealed PDF of a completed document; version=original is the uploaded file.',
      mimeType: 'application/pdf',
    },
    async (uri, variables) => {
      const envelopeId = firstVariable(variables.envelopeId) ?? '';
      const envelopeItemId = firstVariable(variables.envelopeItemId) ?? '';

      const requestedVersion = firstVariable(variables.version) ?? uri.searchParams.get('version') ?? 'signed';
      const version: EnvelopePdfVersion = requestedVersion === 'original' ? 'original' : 'signed';

      try {
        const file = await readEnvelopeItemPdf(ctx, { envelopeId, envelopeItemId, version });

        return pdfResource(uri.href, file.bytes);
      } catch (error) {
        return rethrowResourceError(error);
      }
    },
  );

  server.registerResource(
    'envelope-certificate',
    new ResourceTemplate('sr-sign://envelope/{envelopeId}/certificate', { list: undefined }),
    {
      title: 'Signing certificate',
      description: 'The signing certificate PDF of a completed document.',
      mimeType: 'application/pdf',
    },
    async (uri, variables) => {
      const envelopeId = firstVariable(variables.envelopeId) ?? '';

      try {
        const file = await readCertificatePdf(ctx, envelopeId);

        return pdfResource(uri.href, file.bytes);
      } catch (error) {
        return rethrowResourceError(error);
      }
    },
  );

  server.registerResource(
    'envelope-audit-log',
    new ResourceTemplate('sr-sign://envelope/{envelopeId}/audit-log', { list: undefined }),
    {
      title: 'Audit log',
      description: 'The audit log PDF of a document.',
      mimeType: 'application/pdf',
    },
    async (uri, variables) => {
      const envelopeId = firstVariable(variables.envelopeId) ?? '';

      try {
        const file = await readAuditLogPdf(ctx, envelopeId);

        return pdfResource(uri.href, file.bytes);
      } catch (error) {
        return rethrowResourceError(error);
      }
    },
  );
};

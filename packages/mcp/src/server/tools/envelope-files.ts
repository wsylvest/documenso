import { APP_DOCUMENT_UPLOAD_SIZE_LIMIT } from '@documenso/lib/constants/app';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { megabytesToBytes } from '@documenso/lib/universal/unit-convertions';
import { ZCreateEnvelopePayloadSchema } from '@documenso/trpc/server/envelope-router/create-envelope.types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { EnvelopeType } from '@prisma/client';
import { z } from 'zod';

import { MCP_INLINE_PDF_MAX_BYTES } from '../../constants';
import type { McpToolContext } from '../context';
import { defineTool, TOOL_ANNOTATIONS } from '../define-tool';
import {
  buildAuditLogUri,
  buildCertificateUri,
  buildEnvelopeItemDownloadApiUrl,
  buildEnvelopeItemPdfUri,
  type McpPdfFile,
  readAuditLogPdf,
  readCertificatePdf,
  readEnvelopeItemPdf,
  toBase64,
} from '../files';
import { ZEnvelopeIdSchema } from './envelopes';

const URL_FETCH_TIMEOUT_MS = 30_000;

export const ZEnvelopeFileInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(255)
      .describe('File name including extension, e.g. "roofing-contract.pdf". Used as the envelope item title.'),
    base64: z.string().min(1).optional().describe('The file contents encoded as base64 (no data: prefix).'),
    url: z
      .string()
      .url()
      .optional()
      .describe('A publicly reachable http(s) URL the server downloads the file from. Use instead of base64.'),
  })
  .refine((file) => Boolean(file.base64) !== Boolean(file.url), {
    message: 'Provide exactly one of base64 or url for each file',
  });

export const ZCreateEnvelopeInputSchema = ZCreateEnvelopePayloadSchema.pick({
  title: true,
  externalId: true,
  visibility: true,
  globalAccessAuth: true,
  globalActionAuth: true,
  folderId: true,
  recipients: true,
  meta: true,
}).extend({
  type: z
    .nativeEnum(EnvelopeType)
    .default(EnvelopeType.DOCUMENT)
    .describe('DOCUMENT to send for signature, TEMPLATE to create a reusable template.'),
  files: z
    .array(ZEnvelopeFileInputSchema)
    .min(1)
    .max(10)
    .describe(
      'The PDF files for this envelope. Each becomes an envelope item. Recipient fields can reference a file by its name or index via "identifier".',
    ),
});

export const ZCreateEnvelopeOutputSchema = z.object({
  envelopeId: z.string(),
  type: z.nativeEnum(EnvelopeType),
});

export const ZPdfVersionSchema = z
  .enum(['signed', 'original'])
  .default('signed')
  .describe('"signed" is the sealed PDF with signatures (completed envelopes only); "original" is the uploaded PDF.');

const ZInlineSchema = z
  .boolean()
  .default(false)
  .describe(
    'When true the PDF is also embedded as a base64 resource block. Default false: only a resource link is returned and the client reads the resource when needed.',
  );

export const ZDownloadEnvelopePdfOutputSchema = z.object({
  envelopeId: z.string(),
  envelopeItemId: z.string(),
  title: z.string(),
  fileName: z.string(),
  version: z.enum(['signed', 'original']),
  mimeType: z.literal('application/pdf'),
  sizeBytes: z.number(),
  uri: z.string().describe('MCP resource URI. Read it with resources/read to obtain the bytes.'),
  apiUrl: z.string().describe('REST API URL for the same file; requires the API token as a bearer header.'),
});

export const ZDownloadGeneratedPdfOutputSchema = z.object({
  envelopeId: z.string(),
  title: z.string(),
  fileName: z.string(),
  mimeType: z.literal('application/pdf'),
  sizeBytes: z.number(),
  uri: z.string().describe('MCP resource URI. Read it with resources/read to obtain the bytes.'),
});

const maxUploadBytes = () => megabytesToBytes(APP_DOCUMENT_UPLOAD_SIZE_LIMIT);

const guessMimeType = (name: string) => {
  if (/\.docx$/i.test(name)) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }

  return 'application/pdf';
};

const fileFromBase64 = (name: string, base64: string): File => {
  const cleaned = base64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');

  let bytes: Buffer;

  try {
    bytes = Buffer.from(cleaned, 'base64');
  } catch {
    throw new AppError(AppErrorCode.INVALID_REQUEST, { message: `File "${name}" is not valid base64` });
  }

  if (bytes.length === 0) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, { message: `File "${name}" is empty` });
  }

  if (bytes.length > maxUploadBytes()) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `File "${name}" exceeds the ${APP_DOCUMENT_UPLOAD_SIZE_LIMIT}MB upload limit`,
    });
  }

  return new File([bytes], name, { type: guessMimeType(name) });
};

const fileFromUrl = async (name: string, url: string): Promise<File> => {
  const parsed = new URL(url);

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AppError(AppErrorCode.INVALID_REQUEST, { message: `File "${name}" URL must use http or https` });
  }

  const response = await fetch(parsed, {
    redirect: 'follow',
    signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `Could not download "${name}": ${error instanceof Error ? error.message : 'request failed'}`,
    });
  });

  if (!response.ok) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `Could not download "${name}": HTTP ${response.status}`,
    });
  }

  const declaredLength = Number(response.headers.get('content-length') ?? '0');

  if (declaredLength > maxUploadBytes()) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `File "${name}" exceeds the ${APP_DOCUMENT_UPLOAD_SIZE_LIMIT}MB upload limit`,
    });
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  if (bytes.length === 0 || bytes.length > maxUploadBytes()) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `File "${name}" is empty or exceeds the ${APP_DOCUMENT_UPLOAD_SIZE_LIMIT}MB upload limit`,
    });
  }

  return new File([bytes], name, { type: response.headers.get('content-type') ?? guessMimeType(name) });
};

const resourceLink = (file: McpPdfFile, uri: string): ContentBlock => ({
  type: 'resource_link',
  uri,
  name: file.fileName,
  title: file.title,
  mimeType: file.mimeType,
  description: `${file.bytes.byteLength} bytes`,
});

const inlineBlob = (file: McpPdfFile, uri: string): ContentBlock => {
  if (file.bytes.byteLength > MCP_INLINE_PDF_MAX_BYTES) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `The PDF is too large to return inline (${file.bytes.byteLength} bytes). Read the resource ${uri} instead.`,
    });
  }

  return {
    type: 'resource',
    resource: {
      uri,
      mimeType: file.mimeType,
      blob: toBase64(file.bytes),
    },
  };
};

export const registerEnvelopeFileTools = (server: McpServer, ctx: McpToolContext) => {
  defineTool(server, ctx, {
    name: 'create_envelope',
    title: 'Create envelope from files',
    description:
      'Create a document (or template) from one or more uploaded PDFs supplied as base64 or as a URL. Optionally add recipients and fields in the same call. The envelope is created as a draft; send it with distribute_envelope.',
    inputSchema: ZCreateEnvelopeInputSchema,
    outputSchema: ZCreateEnvelopeOutputSchema,
    annotations: TOOL_ANNOTATIONS.createOpenWorld,
    identifiers: (input) => ({ folderId: input.folderId }),
    handler: async (input) => {
      const { files, ...payloadInput } = input;

      const uploads = await Promise.all(
        files.map(async (file) => {
          if (file.base64) {
            return fileFromBase64(file.name, file.base64);
          }

          if (file.url) {
            return await fileFromUrl(file.name, file.url);
          }

          throw new AppError(AppErrorCode.INVALID_REQUEST, { message: `File "${file.name}" has no contents` });
        }),
      );

      const payload = ZCreateEnvelopePayloadSchema.parse(payloadInput);

      const result = await ctx.caller.envelope.create({ payload, files: uploads });

      return {
        structured: { envelopeId: result.id, type: payload.type },
        text: `Created ${payload.type.toLowerCase()} ${result.id} with ${uploads.length} file(s).`,
      };
    },
  });

  defineTool(server, ctx, {
    name: 'download_envelope_pdf',
    title: 'Download envelope PDF',
    description:
      'Get the PDF of an envelope item as a resource link (the sealed, signed PDF for completed documents, or the original upload). The link URI can be read with resources/read. Set inline: true to also embed the base64 bytes.',
    inputSchema: z.object({
      envelopeId: ZEnvelopeIdSchema,
      envelopeItemId: z
        .string()
        .optional()
        .describe('Which file of the envelope to download. Defaults to the first envelope item.'),
      version: ZPdfVersionSchema,
      inline: ZInlineSchema,
    }),
    outputSchema: ZDownloadEnvelopePdfOutputSchema,
    annotations: TOOL_ANNOTATIONS.readOnly,
    identifiers: (input) => ({ envelopeId: input.envelopeId, envelopeItemId: input.envelopeItemId }),
    handler: async ({ envelopeId, envelopeItemId, version, inline }) => {
      const file = await readEnvelopeItemPdf(ctx, { envelopeId, envelopeItemId, version });

      const uri = buildEnvelopeItemPdfUri(file.envelopeId, file.envelopeItemId, version);

      const content: ContentBlock[] = [resourceLink(file, uri)];

      if (inline) {
        content.push(inlineBlob(file, uri));
      }

      return {
        structured: {
          envelopeId: file.envelopeId,
          envelopeItemId: file.envelopeItemId,
          title: file.title,
          fileName: file.fileName,
          version,
          mimeType: file.mimeType,
          sizeBytes: file.bytes.byteLength,
          uri,
          apiUrl: buildEnvelopeItemDownloadApiUrl(ctx.baseUrl, file.envelopeItemId, version),
        },
        text: `${file.fileName} (${file.bytes.byteLength} bytes) available at ${uri}`,
        content,
      };
    },
  });

  defineTool(server, ctx, {
    name: 'download_certificate',
    title: 'Download signing certificate',
    description:
      'Generate the signing certificate PDF of a completed document (who signed, when, from where) and return it as a resource link. Set inline: true to also embed the base64 bytes.',
    inputSchema: z.object({ envelopeId: ZEnvelopeIdSchema, inline: ZInlineSchema }),
    outputSchema: ZDownloadGeneratedPdfOutputSchema,
    annotations: TOOL_ANNOTATIONS.readOnly,
    identifiers: (input) => ({ envelopeId: input.envelopeId }),
    handler: async ({ envelopeId, inline }) => {
      const file = await readCertificatePdf(ctx, envelopeId);

      const uri = buildCertificateUri(envelopeId);

      const content: ContentBlock[] = [resourceLink(file, uri)];

      if (inline) {
        content.push(inlineBlob(file, uri));
      }

      return {
        structured: {
          envelopeId,
          title: file.title,
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.bytes.byteLength,
          uri,
        },
        text: `${file.fileName} (${file.bytes.byteLength} bytes) available at ${uri}`,
        content,
      };
    },
  });

  defineTool(server, ctx, {
    name: 'download_audit_log',
    title: 'Download audit log',
    description:
      'Generate the audit log PDF of a document and return it as a resource link. Set inline: true to also embed the base64 bytes.',
    inputSchema: z.object({ envelopeId: ZEnvelopeIdSchema, inline: ZInlineSchema }),
    outputSchema: ZDownloadGeneratedPdfOutputSchema,
    annotations: TOOL_ANNOTATIONS.readOnly,
    identifiers: (input) => ({ envelopeId: input.envelopeId }),
    handler: async ({ envelopeId, inline }) => {
      const file = await readAuditLogPdf(ctx, envelopeId);

      const uri = buildAuditLogUri(envelopeId);

      const content: ContentBlock[] = [resourceLink(file, uri)];

      if (inline) {
        content.push(inlineBlob(file, uri));
      }

      return {
        structured: {
          envelopeId,
          title: file.title,
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.bytes.byteLength,
          uri,
        },
        text: `${file.fileName} (${file.bytes.byteLength} bytes) available at ${uri}`,
        content,
      };
    },
  });
};

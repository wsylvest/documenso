import { PDF_SIZE_A4_72PPI } from '@documenso/lib/constants/pdf';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { getEnvelopeById, getEnvelopeWhereInput } from '@documenso/lib/server-only/envelope/get-envelope-by-id';
import { generateAuditLogPdf } from '@documenso/lib/server-only/pdf/generate-audit-log-pdf';
import { generateCertificatePdf } from '@documenso/lib/server-only/pdf/generate-certificate-pdf';
import { getFileServerSide } from '@documenso/lib/universal/upload/get-file.server';
import { isDocumentCompleted } from '@documenso/lib/utils/document';
import { prisma } from '@documenso/prisma';
import { DocumentStatus, EnvelopeType } from '@prisma/client';

import { MCP_RESOURCE_URI_SCHEME } from '../constants';
import type { McpToolContext } from './context';

export type EnvelopePdfVersion = 'signed' | 'original';

export type McpPdfFile = {
  envelopeId: string;
  title: string;
  fileName: string;
  bytes: Uint8Array;
  mimeType: 'application/pdf';
};

const stripPdfExtension = (title: string) => title.replace(/\.pdf$/i, '');

/**
 * Resource URIs for binary downloads. Kept in one place so tools (which emit
 * `resource_link`s) and the resource handlers (which serve them) agree.
 */
export const buildEnvelopeItemPdfUri = (envelopeId: string, envelopeItemId: string, version: EnvelopePdfVersion) =>
  `${MCP_RESOURCE_URI_SCHEME}://envelope/${envelopeId}/item/${envelopeItemId}/pdf?version=${version}`;

export const buildCertificateUri = (envelopeId: string) =>
  `${MCP_RESOURCE_URI_SCHEME}://envelope/${envelopeId}/certificate`;

export const buildAuditLogUri = (envelopeId: string) => `${MCP_RESOURCE_URI_SCHEME}://envelope/${envelopeId}/audit-log`;

export const buildEnvelopeUri = (envelopeId: string) => `${MCP_RESOURCE_URI_SCHEME}://envelope/${envelopeId}`;

export const buildTemplateUri = (envelopeId: string) => `${MCP_RESOURCE_URI_SCHEME}://template/${envelopeId}`;

/**
 * REST API V2 URL for the same file, for clients that prefer plain HTTP with
 * their API token.
 */
export const buildEnvelopeItemDownloadApiUrl = (baseUrl: string, envelopeItemId: string, version: EnvelopePdfVersion) =>
  `${baseUrl.replace(/\/+$/, '')}/api/v2/envelope/item/${envelopeItemId}/download?version=${version}`;

type ReadEnvelopeItemPdfOptions = {
  envelopeId: string;
  envelopeItemId?: string;
  version: EnvelopePdfVersion;
};

/**
 * Read an envelope item PDF under the caller's permissions. Mirrors the API V2
 * Hono download route: `signed` is the current (sealed when completed) data,
 * `original` the data as uploaded.
 */
export const readEnvelopeItemPdf = async (
  ctx: McpToolContext,
  { envelopeId, envelopeItemId, version }: ReadEnvelopeItemPdfOptions,
): Promise<McpPdfFile & { envelopeItemId: string; version: EnvelopePdfVersion }> => {
  const envelope = await getEnvelopeById({
    id: { type: 'envelopeId', id: envelopeId },
    userId: ctx.auth.user.id,
    teamId: ctx.auth.teamId,
    type: null,
  });

  const envelopeItem = envelopeItemId
    ? envelope.envelopeItems.find((item) => item.id === envelopeItemId)
    : envelope.envelopeItems.at(0);

  if (!envelopeItem) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'Envelope item not found',
      statusCode: 404,
    });
  }

  if (version === 'signed' && !isDocumentCompleted(envelope.status)) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'The signed PDF is only available once the envelope is completed. Use version "original" instead.',
      statusCode: 400,
    });
  }

  const documentData = envelopeItem.documentData;

  const bytes = await getFileServerSide({
    type: documentData.type,
    data: version === 'signed' ? documentData.data : documentData.initialData,
  });

  const baseTitle = stripPdfExtension(envelopeItem.title);

  return {
    envelopeId: envelope.id,
    envelopeItemId: envelopeItem.id,
    version,
    title: envelopeItem.title,
    fileName: version === 'signed' ? `${baseTitle}_signed.pdf` : `${baseTitle}.pdf`,
    bytes,
    mimeType: 'application/pdf',
  };
};

/**
 * Generate the signing certificate for a completed document. Same checks and
 * generator as the API V2 download route.
 */
export const readCertificatePdf = async (ctx: McpToolContext, envelopeId: string): Promise<McpPdfFile> => {
  const { envelopeWhereInput } = await getEnvelopeWhereInput({
    id: { type: 'envelopeId', id: envelopeId },
    type: EnvelopeType.DOCUMENT,
    userId: ctx.auth.user.id,
    teamId: ctx.auth.teamId,
  });

  const envelope = await prisma.envelope.findFirst({
    where: envelopeWhereInput,
    include: {
      recipients: true,
      fields: {
        include: {
          signature: true,
        },
      },
      documentMeta: true,
      user: {
        select: {
          email: true,
          name: true,
        },
      },
    },
  });

  if (!envelope) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'Document not found',
      statusCode: 404,
    });
  }

  if (!isDocumentCompleted(envelope.status) || envelope.status === DocumentStatus.CANCELLED) {
    throw new AppError('DOCUMENT_NOT_COMPLETE', {
      message: 'Document is not complete',
      statusCode: 400,
    });
  }

  const certificatePdf = await generateCertificatePdf({
    envelope,
    recipients: envelope.recipients,
    fields: envelope.fields,
    language: envelope.documentMeta.language,
    envelopeOwner: {
      email: envelope.user.email,
      name: envelope.user.name || '',
    },
    pageWidth: PDF_SIZE_A4_72PPI.width,
    pageHeight: PDF_SIZE_A4_72PPI.height,
  });

  const bytes = await certificatePdf.save();

  return {
    envelopeId: envelope.id,
    title: envelope.title,
    fileName: `${stripPdfExtension(envelope.title)}_certificate.pdf`,
    bytes,
    mimeType: 'application/pdf',
  };
};

/**
 * Generate the audit log PDF for a document.
 */
export const readAuditLogPdf = async (ctx: McpToolContext, envelopeId: string): Promise<McpPdfFile> => {
  const envelope = await getEnvelopeById({
    id: { type: 'envelopeId', id: envelopeId },
    type: EnvelopeType.DOCUMENT,
    userId: ctx.auth.user.id,
    teamId: ctx.auth.teamId,
  });

  const auditLogPdf = await generateAuditLogPdf({
    envelope,
    recipients: envelope.recipients,
    fields: envelope.fields,
    language: envelope.documentMeta.language,
    envelopeOwner: {
      email: envelope.user.email,
      name: envelope.user.name || '',
    },
    envelopeItems: envelope.envelopeItems.map((item) => item.title),
    pageWidth: PDF_SIZE_A4_72PPI.width,
    pageHeight: PDF_SIZE_A4_72PPI.height,
  });

  const bytes = await auditLogPdf.save();

  return {
    envelopeId: envelope.id,
    title: envelope.title,
    fileName: `${stripPdfExtension(envelope.title)}_audit-log.pdf`,
    bytes,
    mimeType: 'application/pdf',
  };
};

export const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

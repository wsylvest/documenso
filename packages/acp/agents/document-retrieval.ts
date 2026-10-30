import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { PDF_SIZE_A4_72PPI } from '@documenso/lib/constants/pdf';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { getEnvelopeWhereInput } from '@documenso/lib/server-only/envelope/get-envelope-by-id';
import { generateAuditLogPdf } from '@documenso/lib/server-only/pdf/generate-audit-log-pdf';
import { generateCertificatePdf } from '@documenso/lib/server-only/pdf/generate-certificate-pdf';
import { getFileServerSide } from '@documenso/lib/universal/upload/get-file.server';
import { isDocumentCompleted } from '@documenso/lib/utils/document';
import { prisma } from '@documenso/prisma';
import { DocumentStatus, EnvelopeType } from '@prisma/client';
import { z } from 'zod';

import {
  base64Part,
  JSON_CONTENT_TYPE,
  jsonPart,
  PDF_CONTENT_TYPE,
  TEXT_CONTENT_TYPE,
  textPart,
  urlPart,
} from '../protocol/messages';
import type { TMessagePart } from '../protocol/schemas';
import {
  getDocumentEnvelopeForPrincipal,
  summariseEnvelope,
  toEnvelopeIdOptions,
  ZEnvelopeReferenceSchema,
} from './shared';
import { defineAgent } from './types';

const ZArtifactSchema = z.enum(['document', 'certificate', 'audit-log']);

export const ZDocumentRetrievalInputSchema = ZEnvelopeReferenceSchema.extend({
  artifacts: z
    .array(ZArtifactSchema)
    .min(1)
    .default(['document', 'certificate', 'audit-log'])
    .describe('Which artefacts to return.'),
  inline: z
    .boolean()
    .default(false)
    .describe('Return the PDFs as base64 parts instead of authenticated download URLs.'),
});

export type TDocumentRetrievalInput = z.infer<typeof ZDocumentRetrievalInputSchema>;

const apiV2Url = (path: string) => `${NEXT_PUBLIC_WEBAPP_URL()}/api/v2${path}`;

export const documentRetrievalAgent = defineAgent<TDocumentRetrievalInput, null>({
  name: 'document-retrieval',
  description:
    'Retrieve the artefacts of a document: the sealed (or original) PDF for each envelope item, the signing ' +
    'certificate and the audit log, as authenticated download URLs or inline base64 PDFs.',
  inputSchema: ZDocumentRetrievalInputSchema,
  inputContentTypes: [JSON_CONTENT_TYPE, TEXT_CONTENT_TYPE],
  outputContentTypes: [JSON_CONTENT_TYPE, TEXT_CONTENT_TYPE, PDF_CONTENT_TYPE],
  metadata: {
    tags: ['documenso', 'documents', 'artifacts'],
    capabilities: [
      { name: 'document', description: 'Sealed PDF of a completed document, original PDF otherwise' },
      { name: 'certificate', description: 'Signing certificate PDF (completed documents only)' },
      { name: 'audit-log', description: 'Audit log PDF' },
    ],
  },
  step: async ({ input, principal }) => {
    const id = toEnvelopeIdOptions(input);

    const envelope = await getDocumentEnvelopeForPrincipal(principal, id);

    const isCompleted = isDocumentCompleted(envelope.status) && envelope.status !== DocumentStatus.CANCELLED;

    const parts: TMessagePart[] = [];
    const artifacts: Record<string, unknown>[] = [];

    if (input.artifacts.includes('document')) {
      const version = isCompleted ? 'signed' : 'original';

      for (const item of envelope.envelopeItems) {
        const name = `${item.title.replace(/\.pdf$/i, '')}_${version}.pdf`;

        if (input.inline) {
          const bytes = await getFileServerSide({
            type: item.documentData.type,
            data: isCompleted ? item.documentData.data : item.documentData.initialData,
          });

          parts.push(base64Part(name, PDF_CONTENT_TYPE, bytes));
        } else {
          parts.push(
            urlPart(name, PDF_CONTENT_TYPE, apiV2Url(`/envelope/item/${item.id}/download?version=${version}`)),
          );
        }

        artifacts.push({ type: 'document', envelopeItemId: item.id, title: item.title, version, name });
      }
    }

    if (input.artifacts.includes('certificate')) {
      if (!isCompleted) {
        throw new AppError('DOCUMENT_NOT_COMPLETE', {
          message: 'A signing certificate is only available for completed documents',
          statusCode: 400,
        });
      }

      const name = `${envelope.title.replace(/\.pdf$/i, '')}_certificate.pdf`;

      if (input.inline) {
        parts.push(
          base64Part(name, PDF_CONTENT_TYPE, await renderCertificate(principal.user.id, principal.teamId, envelope.id)),
        );
      } else {
        parts.push(urlPart(name, PDF_CONTENT_TYPE, apiV2Url(`/envelope/${envelope.id}/certificate/download`)));
      }

      artifacts.push({ type: 'certificate', name });
    }

    if (input.artifacts.includes('audit-log')) {
      const name = `${envelope.title.replace(/\.pdf$/i, '')}_audit-log.pdf`;

      if (input.inline) {
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

        parts.push(base64Part(name, PDF_CONTENT_TYPE, await auditLogPdf.save()));
      } else {
        parts.push(urlPart(name, PDF_CONTENT_TYPE, apiV2Url(`/envelope/${envelope.id}/audit-log/download`)));
      }

      artifacts.push({ type: 'audit-log', name });
    }

    const result = {
      ...summariseEnvelope(envelope),
      isCompleted,
      artifacts,
      authentication: input.inline ? null : 'Download URLs require the same Authorization header as this run.',
    };

    return {
      type: 'completed',
      output: [
        textPart(`Returned ${artifacts.length} artefact(s) for "${envelope.title}".`, 'summary'),
        jsonPart('result', result),
        ...parts,
      ],
    };
  },
});

/**
 * The certificate needs fields with their signatures, which `getEnvelopeById`
 * does not include. Mirrors the read in `apps/remix/server/api/download`.
 */
const renderCertificate = async (userId: number, teamId: number, envelopeId: string) => {
  const { envelopeWhereInput } = await getEnvelopeWhereInput({
    id: { type: 'envelopeId', id: envelopeId },
    type: EnvelopeType.DOCUMENT,
    userId,
    teamId,
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

  return await certificatePdf.save();
};

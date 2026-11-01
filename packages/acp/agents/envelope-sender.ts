import { APP_DOCUMENT_UPLOAD_SIZE_LIMIT } from '@documenso/lib/constants/app';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { sendDocument } from '@documenso/lib/server-only/document/send-document';
import { getEnvelopeById } from '@documenso/lib/server-only/envelope/get-envelope-by-id';
import { createDocumentFromTemplate } from '@documenso/lib/server-only/template/create-document-from-template';
import {
  ZDocumentMetaDistributionMethodSchema,
  ZDocumentMetaMessageSchema,
  ZDocumentMetaRedirectUrlSchema,
  ZDocumentMetaSubjectSchema,
} from '@documenso/lib/types/document-meta';
import {
  ZClampedFieldHeightSchema,
  ZClampedFieldPositionXSchema,
  ZClampedFieldPositionYSchema,
  ZClampedFieldWidthSchema,
  ZFieldPageNumberSchema,
} from '@documenso/lib/types/field';
import { ZEnvelopeFieldAndMetaSchema, ZFieldMetaPrefillFieldsSchema } from '@documenso/lib/types/field-meta';
import { megabytesToBytes } from '@documenso/lib/universal/unit-convertions';
import { zEmail } from '@documenso/lib/utils/zod';
import { createEnvelopeRouteCaller } from '@documenso/trpc/server/envelope-router/create-envelope';
import { ZCreateEnvelopePayloadSchema } from '@documenso/trpc/server/envelope-router/create-envelope.types';
import { EnvelopeType, RecipientRole } from '@prisma/client';
import type { Logger } from 'pino';
import { z } from 'zod';

import { JSON_CONTENT_TYPE, jsonPart, PDF_CONTENT_TYPE, TEXT_CONTENT_TYPE, textPart } from '../protocol/messages';
import { summariseEnvelope, summariseRecipient } from './shared';
import type { AcpPrincipal, AgentStepResult } from './types';
import { defineAgent } from './types';

export const ENVELOPE_SENDER_APPROVAL_AWAIT_TYPE = 'approval';

const ZSenderFieldSchema = ZEnvelopeFieldAndMetaSchema.and(
  z.object({
    page: ZFieldPageNumberSchema,
    positionX: ZClampedFieldPositionXSchema,
    positionY: ZClampedFieldPositionYSchema,
    width: ZClampedFieldWidthSchema,
    height: ZClampedFieldHeightSchema,
    envelopeItemIndex: z.number().int().min(0).optional().describe('Index of the PDF the field belongs to.'),
  }),
);

const ZSenderRecipientSchema = z.object({
  email: zEmail(),
  name: z.string().max(255).optional(),
  role: z.nativeEnum(RecipientRole).default(RecipientRole.SIGNER),
  signingOrder: z.number().int().positive().optional(),
  templateRecipientId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'When sending from a template, the template recipient this person replaces. Defaults to positional order.',
    ),
  fields: z
    .array(ZSenderFieldSchema)
    .optional()
    .describe(
      'Fields to place for this recipient. Only used when sending an inline PDF; templates define their own fields.',
    ),
});

export const ZEnvelopeSenderInputSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    templateId: z.string().min(1).optional().describe('Envelope ID of the template to create the document from.'),
    pdf: z
      .object({
        name: z.string().min(1).max(255),
        base64: z.string().min(1),
      })
      .optional()
      .describe('An inline PDF. May also be supplied as an application/pdf message part with base64 encoding.'),
    externalId: z.string().max(255).optional(),
    recipients: z.array(ZSenderRecipientSchema).min(1),
    prefillFields: z.array(ZFieldMetaPrefillFieldsSchema).optional(),
    meta: z
      .object({
        subject: ZDocumentMetaSubjectSchema.optional(),
        message: ZDocumentMetaMessageSchema.optional(),
        redirectUrl: ZDocumentMetaRedirectUrlSchema.optional(),
        distributionMethod: ZDocumentMetaDistributionMethodSchema.optional(),
      })
      .optional(),
    distribute: z.boolean().default(true).describe('Send the document to recipients once created.'),
    requireApproval: z
      .boolean()
      .default(false)
      .describe('Pause the run in the "awaiting" state for a human approval before distributing.'),
  })
  .refine((input) => Boolean(input.templateId) !== Boolean(input.pdf), {
    message: 'Provide exactly one of templateId or pdf',
  });

export type TEnvelopeSenderInput = z.infer<typeof ZEnvelopeSenderInputSchema>;

export const ZEnvelopeSenderApprovalResumeSchema = z.object({
  type: z.literal(ENVELOPE_SENDER_APPROVAL_AWAIT_TYPE),
  approved: z.boolean(),
  reason: z.string().max(1000).optional(),
});

type EnvelopeSenderState = {
  envelopeId: string;
};

export const envelopeSenderAgent = defineAgent<TEnvelopeSenderInput, EnvelopeSenderState>({
  name: 'envelope-sender',
  description:
    'Create a document for signature from a template or an inline PDF, set its recipients and fields, prefill ' +
    'template fields, optionally pause for a human approval, then distribute it and report the signing URLs.',
  inputSchema: ZEnvelopeSenderInputSchema,
  inputContentTypes: [JSON_CONTENT_TYPE, TEXT_CONTENT_TYPE, PDF_CONTENT_TYPE],
  outputContentTypes: [JSON_CONTENT_TYPE, TEXT_CONTENT_TYPE],
  metadata: {
    tags: ['sr-sign', 'envelopes', 'send'],
    capabilities: [
      { name: 'create-from-template', description: 'Create a document from a template envelope' },
      { name: 'create-from-pdf', description: 'Create a document from an inline PDF with recipients and fields' },
      { name: 'approval', description: 'Await a human approval before distribution' },
      { name: 'distribute', description: 'Send the document to its recipients' },
    ],
    awaitTypes: [ENVELOPE_SENDER_APPROVAL_AWAIT_TYPE],
  },
  step: async ({ input, principal, state, resume, logger, progress, signal }) => {
    const { user, teamId, metadata } = principal;

    const envelopeId: string =
      state?.envelopeId ??
      (input.templateId
        ? await createFromTemplate({ input, principal, templateId: input.templateId })
        : await createFromPdf({ input, principal, logger }));

    if (!state?.envelopeId) {
      logger.info({ msg: 'ACP envelope-sender created envelope', envelopeId, fromTemplate: Boolean(input.templateId) });

      await progress('Envelope created', { envelopeId });
    }

    const loadEnvelope = async () =>
      await getEnvelopeById({
        id: { type: 'envelopeId', id: envelopeId },
        type: EnvelopeType.DOCUMENT,
        userId: user.id,
        teamId,
      });

    if (!input.distribute) {
      const envelope = await loadEnvelope();

      return completed(envelope, 'Draft created; distribution was not requested.');
    }

    if (input.requireApproval && !resume) {
      const envelope = await loadEnvelope();

      return {
        type: 'awaiting',
        state: { envelopeId },
        awaitRequest: {
          type: ENVELOPE_SENDER_APPROVAL_AWAIT_TYPE,
          message: {
            role: 'agent/envelope-sender',
            parts: [
              textPart(
                `Approve sending "${envelope.title}" to ${envelope.recipients.map((recipient) => recipient.email).join(', ')}? ` +
                  `Resume with { "type": "approval", "approved": true | false }.`,
                'prompt',
              ),
              jsonPart('pending', {
                ...summariseEnvelope(envelope),
                recipients: envelope.recipients.map(summariseRecipient),
              }),
            ],
          },
        },
      };
    }

    if (resume) {
      const decision = ZEnvelopeSenderApprovalResumeSchema.safeParse(resume);

      if (!decision.success) {
        throw new AppError(AppErrorCode.INVALID_BODY, {
          message: 'Resume payload must be { "type": "approval", "approved": boolean }',
          statusCode: 400,
        });
      }

      if (!decision.data.approved) {
        const envelope = await loadEnvelope();

        logger.info({ msg: 'ACP envelope-sender approval declined', envelopeId, reason: decision.data.reason });

        return completed(envelope, `Distribution declined${decision.data.reason ? `: ${decision.data.reason}` : ''}.`, {
          approved: false,
        });
      }
    }

    if (signal.aborted) {
      const envelope = await loadEnvelope();

      return completed(envelope, 'Run was cancelled before distribution.');
    }

    await sendDocument({
      id: { type: 'envelopeId', id: envelopeId },
      userId: user.id,
      teamId,
      requestMetadata: metadata,
    });

    const envelope = await loadEnvelope();

    return completed(envelope, `"${envelope.title}" sent to ${envelope.recipients.length} recipient(s).`, {
      approved: input.requireApproval ? true : undefined,
    });
  },
});

type CompletedEnvelope = Awaited<ReturnType<typeof getEnvelopeById>>;

const completed = (
  envelope: CompletedEnvelope,
  summary: string,
  extra: Record<string, unknown> = {},
): AgentStepResult<EnvelopeSenderState> => {
  return {
    type: 'completed' as const,
    output: [
      textPart(summary, 'summary'),
      jsonPart('result', {
        ...summariseEnvelope(envelope),
        recipients: envelope.recipients.map(summariseRecipient),
        ...extra,
      }),
    ],
  };
};

type CreateFromTemplateOptions = {
  input: TEnvelopeSenderInput;
  principal: AcpPrincipal;
  templateId: string;
};

const createFromTemplate = async ({ input, principal, templateId }: CreateFromTemplateOptions): Promise<string> => {
  const { user, teamId, metadata } = principal;

  const template = await getEnvelopeById({
    id: { type: 'envelopeId', id: templateId },
    type: EnvelopeType.TEMPLATE,
    userId: user.id,
    teamId,
  });

  const templateRecipients = [...template.recipients].sort(
    (a, b) => (a.signingOrder ?? Number.MAX_SAFE_INTEGER) - (b.signingOrder ?? Number.MAX_SAFE_INTEGER) || a.id - b.id,
  );

  const recipients = input.recipients.map((recipient, index) => {
    const templateRecipient =
      recipient.templateRecipientId !== undefined
        ? templateRecipients.find((candidate) => candidate.id === recipient.templateRecipientId)
        : templateRecipients[index];

    if (!templateRecipient) {
      throw new AppError(AppErrorCode.INVALID_BODY, {
        message:
          recipient.templateRecipientId !== undefined
            ? `Template recipient ${recipient.templateRecipientId} does not exist on template ${templateId}`
            : `Template ${templateId} has ${templateRecipients.length} recipient(s); cannot map recipient #${index + 1}`,
        statusCode: 400,
      });
    }

    return {
      id: templateRecipient.id,
      email: recipient.email,
      name: recipient.name,
      signingOrder: recipient.signingOrder,
    };
  });

  const envelope = await createDocumentFromTemplate({
    id: { type: 'envelopeId', id: templateId },
    externalId: input.externalId,
    userId: user.id,
    teamId,
    recipients,
    prefillFields: input.prefillFields,
    override: {
      title: input.title,
      subject: input.meta?.subject,
      message: input.meta?.message,
      redirectUrl: input.meta?.redirectUrl,
      distributionMethod: input.meta?.distributionMethod,
    },
    requestMetadata: metadata,
  });

  return envelope.id;
};

type CreateFromPdfOptions = {
  input: TEnvelopeSenderInput;
  principal: AcpPrincipal;
  logger: Logger;
};

const createFromPdf = async ({ input, principal, logger }: CreateFromPdfOptions): Promise<string> => {
  const { user, teamId, metadata } = principal;

  if (!input.pdf) {
    throw new AppError(AppErrorCode.INVALID_BODY, {
      message: 'A pdf is required when templateId is not provided',
      statusCode: 400,
    });
  }

  const bytes = Buffer.from(input.pdf.base64, 'base64');

  if (bytes.length === 0) {
    throw new AppError(AppErrorCode.INVALID_BODY, {
      message: 'pdf.base64 is not valid base64',
      statusCode: 400,
    });
  }

  if (bytes.length > megabytesToBytes(APP_DOCUMENT_UPLOAD_SIZE_LIMIT)) {
    throw new AppError(AppErrorCode.INVALID_BODY, {
      message: `PDF cannot be larger than ${APP_DOCUMENT_UPLOAD_SIZE_LIMIT}MB`,
      statusCode: 400,
    });
  }

  const fileName = input.pdf.name.toLowerCase().endsWith('.pdf') ? input.pdf.name : `${input.pdf.name}.pdf`;

  const file = new File([bytes], fileName, { type: PDF_CONTENT_TYPE });

  const payload = ZCreateEnvelopePayloadSchema.parse({
    type: EnvelopeType.DOCUMENT,
    title: input.title ?? fileName.replace(/\.pdf$/i, ''),
    externalId: input.externalId,
    recipients: input.recipients.map((recipient) => ({
      email: recipient.email,
      name: recipient.name ?? '',
      role: recipient.role,
      signingOrder: recipient.signingOrder,
      fields: recipient.fields?.map(({ envelopeItemIndex, ...field }) => ({
        ...field,
        identifier: envelopeItemIndex,
      })),
    })),
    meta: input.meta,
  });

  const { id } = await createEnvelopeRouteCaller({
    userId: user.id,
    teamId,
    input: { payload, files: [file] },
    apiRequestMetadata: metadata,
    logger,
  });

  return id;
};

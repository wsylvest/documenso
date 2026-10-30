import { prepareCscRecipientSigning } from '@documenso/ee/server-only/signing/csc/prepare-recipient-signing';
import { PAPER_COPY_REQUESTED_REJECTION_REASON } from '@documenso/lib/constants/electronic-consent';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { completeDocumentWithToken } from '@documenso/lib/server-only/document/complete-document-with-token';
import { rejectDocumentWithToken } from '@documenso/lib/server-only/document/reject-document-with-token';
import { viewedDocument } from '@documenso/lib/server-only/document/viewed-document';
import { consentToElectronicSigning } from '@documenso/lib/server-only/envelope/consent-to-electronic-signing';
import { getEnvelopeSigningStatus } from '@documenso/lib/server-only/envelope/get-envelope-signing-status';
import { signEnvelopeField } from '@documenso/lib/server-only/envelope/sign-envelope-field';
import { getRecipientByToken } from '@documenso/lib/server-only/recipient/get-recipient-by-token';
import { ZRecipientAccessAuthSchema } from '@documenso/lib/types/document-auth';
import { isTspEnvelope } from '@documenso/lib/types/signature-level';
import type { RequestMetadata } from '@documenso/lib/universal/extract-request-metadata';
import { zEmail } from '@documenso/lib/utils/zod';
import { ZSignEnvelopeFieldValue } from '@documenso/trpc/server/envelope-router/sign-envelope-field.types';
import { assertSigningAccessAuth } from '@documenso/trpc/server/signing-router/assert-signing-access-auth';
import { getSigningRecipient } from '@documenso/trpc/server/signing-router/get-signing-recipient';
import { ZSignerMetadataSchema, ZSigningTokenSchema } from '@documenso/trpc/server/signing-router/schema';
import type { Logger } from 'pino';
import { z } from 'zod';

import { JSON_CONTENT_TYPE, jsonPart, TEXT_CONTENT_TYPE, textPart } from '../protocol/messages';
import type { TAwaitRequest, TAwaitResume } from '../protocol/schemas';
import { getDocumentEnvelopeForPrincipal, summariseEnvelope, summariseRecipient } from './shared';
import { resolveSignerRequestMetadata } from './signer-metadata';
import type { AcpPrincipal, AgentStepResult } from './types';
import { defineAgent } from './types';

export const RECIPIENT_SIGNER_CONSENT_AWAIT_TYPE = 'consent';
export const RECIPIENT_SIGNER_CONFIRMATION_AWAIT_TYPE = 'confirmation';

const ZSignerFieldSchema = z.object({
  fieldId: z.number().int().positive(),
  fieldValue: ZSignEnvelopeFieldValue.describe(
    'The typed value to insert, discriminated by the field type. Send null to clear a field. Signature fields take a typed name or a data:image/png;base64 URL.',
  ),
});

const ZNextSignerSchema = z.object({
  email: zEmail().max(254),
  name: z.string().min(1).max(255),
});

export const ZRecipientSignerInputSchema = z.object({
  token: ZSigningTokenSchema,
  action: z
    .enum(['status', 'view', 'consent', 'sign', 'complete', 'reject'])
    .default('sign')
    .describe(
      '"sign" runs the whole flow: view, (consent), insert fields, then pause for the signer to confirm completion.',
    ),
  consent: z
    .boolean()
    .default(false)
    .describe(
      "Record the signer's consent to conduct the transaction electronically before signing. Only set this after the signer actively agreed to the disclosure.",
    ),
  fields: z.array(ZSignerFieldSchema).optional().describe('Fields to insert when action is "sign".'),
  reason: z.string().min(1).max(1000).optional().describe('Rejection reason when action is "reject".'),
  nextSigner: ZNextSignerSchema.optional().describe('Dictate the next signer when the document allows it.'),
  accessAuthOptions: ZRecipientAccessAuthSchema.optional().describe(
    'Access authentication proof (for example the emailed two factor code) for envelopes that require it.',
  ),
  autoComplete: z
    .boolean()
    .default(false)
    .describe('Complete immediately after signing instead of pausing for a human confirmation.'),
  signer: ZSignerMetadataSchema.optional(),
});

export type TRecipientSignerInput = z.infer<typeof ZRecipientSignerInputSchema>;

export const ZRecipientSignerConsentResumeSchema = z.object({
  type: z.literal(RECIPIENT_SIGNER_CONSENT_AWAIT_TYPE),
  consented: z.boolean(),
  signer: ZSignerMetadataSchema.optional(),
});

export const ZRecipientSignerConfirmationResumeSchema = z.object({
  type: z.literal(RECIPIENT_SIGNER_CONFIRMATION_AWAIT_TYPE),
  decision: z.enum(['complete', 'reject']),
  reason: z.string().min(1).max(1000).optional(),
  nextSigner: ZNextSignerSchema.optional(),
  accessAuthOptions: ZRecipientAccessAuthSchema.optional(),
  signer: ZSignerMetadataSchema.optional(),
});

type RecipientSignerState = {
  envelopeId: string;
  recipientId: number;
  signedFieldIds: number[];
};

type SigningRecipient = Awaited<ReturnType<typeof getSigningRecipient>>;

type SignerFlowContext = {
  input: TRecipientSignerInput;
  principal: AcpPrincipal;
  logger: Logger;
  recipient: SigningRecipient;
  requestMetadata: RequestMetadata;
  progress: (message: string, data?: Record<string, unknown>) => Promise<void>;
};

export const recipientSignerAgent = defineAgent<TRecipientSignerInput, RecipientSignerState>({
  name: 'recipient-signer',
  description:
    'Drive the native signing flow for a recipient token on behalf of a human signer: load status, record the ' +
    'view, record ESIGN consent, insert field values, pause for the signer to confirm, then complete or reject.',
  inputSchema: ZRecipientSignerInputSchema,
  inputContentTypes: [JSON_CONTENT_TYPE, TEXT_CONTENT_TYPE],
  outputContentTypes: [JSON_CONTENT_TYPE, TEXT_CONTENT_TYPE],
  metadata: {
    documentation: 'https://docs.documenso.com/developers/api/signing',
    tags: ['documenso', 'signing', 'recipient', 'esign-consent', 'human-in-the-loop'],
    capabilities: [
      { name: 'status', description: 'Overall signing state of the envelope for a recipient token' },
      { name: 'view', description: 'Record the document as viewed and return the fields to complete' },
      { name: 'consent', description: 'Record the signer consent to conduct the transaction electronically' },
      { name: 'sign', description: 'Insert values into the recipient fields' },
      { name: 'confirmation', description: 'Await the human signer confirmation before completing' },
      { name: 'complete', description: 'Complete signing for the recipient' },
      { name: 'reject', description: 'Reject the document with a reason' },
    ],
    awaitTypes: [RECIPIENT_SIGNER_CONSENT_AWAIT_TYPE, RECIPIENT_SIGNER_CONFIRMATION_AWAIT_TYPE],
  },
  step: async ({ input, principal, state, resume, logger, progress }) => {
    const { token } = input;

    // Team scoping identical to the native Signing API: a token from another
    // team is indistinguishable from an unknown one.
    const recipient = await getSigningRecipient({ token, teamId: principal.teamId });

    const flow: SignerFlowContext = {
      input,
      principal,
      logger: logger.child({ envelopeId: recipient.envelopeId, recipientId: recipient.id }),
      recipient,
      requestMetadata: resolveSignerRequestMetadata({ principal, logger, signer: input.signer }),
      progress,
    };

    if (resume) {
      return await resumeFlow(flow, resume, state);
    }

    switch (input.action) {
      case 'status':
        return await finish(flow, 'Signing status loaded.', { action: 'status' });

      case 'view':
        await recordView(flow);

        return await finish(flow, 'Document viewed.', { action: 'view', fields: await listFields(flow) });

      case 'consent':
        await recordConsent(flow);

        return await finish(flow, 'Electronic signing consent recorded.', { action: 'consent' });

      case 'reject':
        return await reject(flow, input.reason ?? 'Rejected by signer', input.accessAuthOptions);

      case 'complete':
        return await complete(flow, input.nextSigner, input.accessAuthOptions);

      case 'sign':
        return await sign(flow, state);
    }
  },
});

const resumeFlow = async (
  flow: SignerFlowContext,
  resume: TAwaitResume,
  state: RecipientSignerState | null,
): Promise<AgentStepResult<RecipientSignerState>> => {
  if (resume.type === RECIPIENT_SIGNER_CONSENT_AWAIT_TYPE) {
    const decision = ZRecipientSignerConsentResumeSchema.safeParse(resume);

    if (!decision.success) {
      throw new AppError(AppErrorCode.INVALID_BODY, {
        message: 'Resume payload must be { "type": "consent", "consented": boolean }',
        statusCode: 400,
      });
    }

    const resumedFlow = withResumedSigner(flow, decision.data.signer);

    if (!decision.data.consented) {
      return await reject(resumedFlow, PAPER_COPY_REQUESTED_REJECTION_REASON, flow.input.accessAuthOptions);
    }

    await recordConsent(resumedFlow);

    return await sign(resumedFlow, state);
  }

  const decision = ZRecipientSignerConfirmationResumeSchema.safeParse(resume);

  if (!decision.success) {
    throw new AppError(AppErrorCode.INVALID_BODY, {
      message: 'Resume payload must be { "type": "confirmation", "decision": "complete" | "reject", "reason"? }',
      statusCode: 400,
    });
  }

  const resumedFlow = withResumedSigner(flow, decision.data.signer);
  const accessAuthOptions = decision.data.accessAuthOptions ?? flow.input.accessAuthOptions;

  if (decision.data.decision === 'reject') {
    return await reject(resumedFlow, decision.data.reason ?? 'Rejected by signer', accessAuthOptions);
  }

  return await complete(resumedFlow, decision.data.nextSigner ?? flow.input.nextSigner, accessAuthOptions);
};

/**
 * A resume request may carry fresher signer details than the original run.
 */
const withResumedSigner = (flow: SignerFlowContext, signer: TRecipientSignerInput['signer']): SignerFlowContext => {
  if (!signer) {
    return flow;
  }

  return {
    ...flow,
    requestMetadata: resolveSignerRequestMetadata({ principal: flow.principal, logger: flow.logger, signer }),
  };
};

const recordView = async ({ recipient, requestMetadata, input }: SignerFlowContext) => {
  const derivedRecipientAccessAuth = await assertSigningAccessAuth({
    recipient,
    envelopeAuthOptions: recipient.envelope.authOptions,
    type: 'ACCESS',
    accessAuthOptions: input.accessAuthOptions,
  });

  await viewedDocument({
    token: recipient.token,
    requestMetadata,
    recipientAccessAuth: derivedRecipientAccessAuth,
  });
};

const recordConsent = async ({ recipient, requestMetadata, logger }: SignerFlowContext) => {
  const consented = await consentToElectronicSigning({ token: recipient.token, requestMetadata });

  logger.info({ msg: 'ACP recipient-signer consent recorded', electronicConsentAt: consented.electronicConsentAt });

  return consented;
};

const sign = async (
  flow: SignerFlowContext,
  state: RecipientSignerState | null,
): Promise<AgentStepResult<RecipientSignerState>> => {
  const { input, recipient, requestMetadata, progress, logger } = flow;

  const signedFieldIds = [...(state?.signedFieldIds ?? [])];

  const buildState = (): RecipientSignerState => ({
    envelopeId: recipient.envelopeId,
    recipientId: recipient.id,
    signedFieldIds,
  });

  if (!state) {
    await recordView(flow);

    if (input.consent) {
      await recordConsent(flow);
    }
  }

  for (const field of input.fields ?? []) {
    if (signedFieldIds.includes(field.fieldId)) {
      continue;
    }

    try {
      await signEnvelopeField({
        token: recipient.token,
        fieldId: field.fieldId,
        fieldValue: field.fieldValue,
        requestMetadata,
      });
    } catch (error) {
      // ESIGN consent is not on record: pause so the integration can show the
      // disclosure and resume with the signer's decision.
      if (error instanceof AppError && error.code === AppErrorCode.ELECTRONIC_CONSENT_REQUIRED) {
        logger.info({ msg: 'ACP recipient-signer awaiting electronic consent' });

        return {
          type: 'awaiting',
          state: buildState(),
          awaitRequest: consentAwaitRequest(flow),
        };
      }

      throw error;
    }

    signedFieldIds.push(field.fieldId);

    await progress('Field signed', { fieldId: field.fieldId });
  }

  const fields = await listFields(flow);

  const remaining = fields.filter((field) => !field.inserted);
  const remainingRequired = remaining.filter((field) => field.required);

  if (input.autoComplete && remainingRequired.length === 0) {
    return await complete(flow, input.nextSigner, input.accessAuthOptions);
  }

  const envelope = await getDocumentEnvelopeForPrincipal(flow.principal, {
    type: 'envelopeId',
    id: recipient.envelopeId,
  });

  return {
    type: 'awaiting',
    state: buildState(),
    awaitRequest: {
      type: RECIPIENT_SIGNER_CONFIRMATION_AWAIT_TYPE,
      message: {
        role: 'agent/recipient-signer',
        parts: [
          textPart(
            `${signedFieldIds.length} field(s) signed on "${envelope.title}"; ${remaining.length} field(s) remain ` +
              `(${remainingRequired.length} required). Resume with ` +
              `{ "type": "confirmation", "decision": "complete" | "reject", "reason"? } to finish.`,
            'prompt',
          ),
          jsonPart('pending', {
            ...summariseEnvelope(envelope),
            recipientId: recipient.id,
            signedFieldIds,
            remainingFields: remaining,
            canComplete: remainingRequired.length === 0,
          }),
        ],
      },
    },
  };
};

const consentAwaitRequest = ({ recipient }: SignerFlowContext): TAwaitRequest => ({
  type: RECIPIENT_SIGNER_CONSENT_AWAIT_TYPE,
  message: {
    role: 'agent/recipient-signer',
    parts: [
      textPart(
        'The signer must consent to conduct this transaction electronically before any field can be signed. ' +
          'Show the consumer disclosure and resume with { "type": "consent", "consented": true } once they agree, ' +
          'or { "type": "consent", "consented": false } to reject and request a paper copy.',
        'prompt',
      ),
      jsonPart('pending', {
        envelopeId: recipient.envelopeId,
        recipientId: recipient.id,
        reason: AppErrorCode.ELECTRONIC_CONSENT_REQUIRED,
        disclosureUrl: '/articles/signature-disclosure',
      }),
    ],
  },
});

const complete = async (
  flow: SignerFlowContext,
  nextSigner: TRecipientSignerInput['nextSigner'],
  accessAuthOptions: TRecipientSignerInput['accessAuthOptions'],
): Promise<AgentStepResult<RecipientSignerState>> => {
  const { recipient, requestMetadata, logger } = flow;

  await assertSigningAccessAuth({
    recipient,
    envelopeAuthOptions: recipient.envelope.authOptions,
    type: 'ACCESS',
  });

  // AES/QES envelopes cannot be completed in place; hand back the trust
  // service provider redirect exactly like the native Signing API.
  if (isTspEnvelope(recipient.envelope)) {
    const redirect = await prepareCscRecipientSigning({
      recipientToken: recipient.token,
      requestMetadata,
    });

    return await finish(flow, 'The signer must finish with the trust service provider.', {
      action: 'complete',
      completion: redirect,
    });
  }

  try {
    await completeDocumentWithToken({
      token: recipient.token,
      id: { type: 'envelopeId', id: recipient.envelopeId },
      accessAuthOptions,
      nextSigner,
      requestMetadata,
    });
  } catch (error) {
    if (error instanceof AppError && error.code === AppErrorCode.RECIPIENT_ALREADY_SIGNED) {
      logger.info({ msg: 'ACP recipient-signer recipient had already signed' });

      return await finish(flow, 'Recipient had already signed.', {
        action: 'complete',
        completion: { status: 'ALREADY_SIGNED' },
      });
    }

    // Completion refused for lack of consent: pause for the disclosure.
    if (error instanceof AppError && error.code === AppErrorCode.ELECTRONIC_CONSENT_REQUIRED) {
      return {
        type: 'awaiting',
        state: { envelopeId: recipient.envelopeId, recipientId: recipient.id, signedFieldIds: [] },
        awaitRequest: consentAwaitRequest(flow),
      };
    }

    throw error;
  }

  logger.info({ msg: 'ACP recipient-signer completed' });

  return await finish(flow, 'Recipient signing completed.', { action: 'complete', completion: { status: 'SIGNED' } });
};

const reject = async (
  flow: SignerFlowContext,
  reason: string,
  accessAuthOptions: TRecipientSignerInput['accessAuthOptions'],
): Promise<AgentStepResult<RecipientSignerState>> => {
  const { recipient, requestMetadata, logger } = flow;

  await assertSigningAccessAuth({
    recipient,
    envelopeAuthOptions: recipient.envelope.authOptions,
    type: 'ACCESS_2FA',
    accessAuthOptions,
  });

  await rejectDocumentWithToken({
    token: recipient.token,
    id: { type: 'envelopeId', id: recipient.envelopeId },
    reason,
    requestMetadata,
  });

  logger.info({ msg: 'ACP recipient-signer rejected' });

  return await finish(flow, `Document rejected: ${reason}`, { action: 'reject', reason });
};

type FieldLike = {
  id: number;
  type: string;
  page: number;
  inserted: boolean;
  fieldMeta: { label?: string; required?: boolean } | null;
};

const summariseField = (field: FieldLike) => ({
  id: field.id,
  type: field.type,
  page: field.page,
  inserted: field.inserted,
  label: field.fieldMeta?.label ?? null,
  required: field.fieldMeta?.required ?? false,
});

const listFields = async ({ recipient }: SignerFlowContext) => {
  const withFields = await getRecipientByToken({ token: recipient.token });

  return withFields.fields.map(summariseField);
};

const finish = async (
  flow: SignerFlowContext,
  summary: string,
  extra: Record<string, unknown>,
): Promise<AgentStepResult<RecipientSignerState>> => {
  const { principal, recipient } = flow;

  const [envelope, signingStatus] = await Promise.all([
    getDocumentEnvelopeForPrincipal(principal, { type: 'envelopeId', id: recipient.envelopeId }),
    getEnvelopeSigningStatus({ token: recipient.token }),
  ]);

  const latestRecipient = envelope.recipients.find((candidate) => candidate.id === recipient.id);

  return {
    type: 'completed',
    output: [
      textPart(`${summary} Envelope signing status: ${signingStatus}.`, 'summary'),
      jsonPart('result', {
        ...summariseEnvelope(envelope),
        signingStatus,
        recipient: latestRecipient
          ? {
              ...summariseRecipient(latestRecipient),
              electronicConsentAt: latestRecipient.electronicConsentAt
                ? latestRecipient.electronicConsentAt.toISOString()
                : null,
            }
          : null,
        ...extra,
      }),
    ],
  };
};

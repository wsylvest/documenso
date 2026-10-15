import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { DOCUMENT_AUDIT_LOG_TYPE } from '@documenso/lib/types/document-audit-logs';
import { prisma } from '@documenso/prisma';
import type { APIRequestContext } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { DocumentStatus, FieldType, ReadStatus, SigningStatus } from '@prisma/client';

import { apiCreateTestContext, apiSeedPendingDocument } from '../../fixtures/api-seeds';

const WEBAPP_BASE_URL = NEXT_PUBLIC_WEBAPP_URL();
const API_BASE_URL = `${WEBAPP_BASE_URL}/api/v2`;

const SIGNER_IP = '203.0.113.42';
const SIGNER_USER_AGENT = 'NativeSigningClient/1.0 (test)';

const authHeader = (apiToken: string) => ({
  Authorization: `Bearer ${apiToken}`,
});

const signingPost = async (
  request: APIRequestContext,
  apiToken: string,
  path: string,
  data: Record<string, unknown>,
  headers: Record<string, string> = {},
) => {
  return await request.post(`${API_BASE_URL}/signing/${path}`, {
    headers: {
      ...authHeader(apiToken),
      ...headers,
    },
    data,
  });
};

test.describe('API V2 native signing', () => {
  test('drives a full signing flow and records forwarded signer metadata in the audit log', async ({ request }) => {
    const {
      envelope,
      token: apiToken,
      distributeResult,
    } = await apiSeedPendingDocument(request, {
      recipients: [{ email: 'native-signer@test.documenso.com', name: 'Native Signer' }],
      fieldsPerRecipient: [
        [
          { type: FieldType.SIGNATURE, page: 1, positionX: 5, positionY: 5, width: 15, height: 5 },
          { type: FieldType.TEXT, page: 1, positionX: 5, positionY: 20, width: 20, height: 5 },
        ],
      ],
    });

    const [recipient] = distributeResult.recipients;
    const signingToken = recipient.token;

    const signatureField = envelope.fields.find(
      (field) => field.recipientId === recipient.id && field.type === FieldType.SIGNATURE,
    );
    const textField = envelope.fields.find(
      (field) => field.recipientId === recipient.id && field.type === FieldType.TEXT,
    );

    if (!signatureField || !textField) {
      throw new Error('Expected fields not found');
    }

    // 1. Read the signing envelope.
    const envelopeResponse = await request.get(`${API_BASE_URL}/signing/envelope?token=${signingToken}`, {
      headers: authHeader(apiToken),
    });

    expect(envelopeResponse.ok(), await envelopeResponse.text()).toBeTruthy();

    const signingEnvelope = await envelopeResponse.json();

    expect(signingEnvelope.envelope.id).toBe(envelope.id);
    expect(signingEnvelope.recipient.id).toBe(recipient.id);
    expect(signingEnvelope.recipient.fields).toHaveLength(2);
    expect(signingEnvelope.isRecipientsTurn).toBe(true);
    expect(signingEnvelope.files).toHaveLength(1);
    expect(signingEnvelope.files[0].envelopeItemId).toBe(envelope.envelopeItems[0].id);

    // The file URL is authorised by the signing token alone.
    const fileResponse = await request.get(signingEnvelope.files[0].url);

    expect(fileResponse.status()).toBe(200);
    expect(fileResponse.headers()['content-type']).toContain('application/pdf');

    // 2. Field signing is refused until the recipient has consented to sign electronically.
    const signBeforeConsent = await signingPost(request, apiToken, 'field/sign', {
      token: signingToken,
      fieldId: textField.id,
      fieldValue: { type: FieldType.TEXT, value: 'too early' },
    });

    expect(signBeforeConsent.status()).toBe(403);
    expect(await signBeforeConsent.text()).toContain('ELECTRONIC_CONSENT_REQUIRED');

    const consentResponse = await signingPost(
      request,
      apiToken,
      'consent',
      { token: signingToken },
      {
        'x-signer-ip-address': SIGNER_IP,
        'x-signer-user-agent': SIGNER_USER_AGENT,
      },
    );

    expect(consentResponse.ok(), await consentResponse.text()).toBeTruthy();

    const consentedRecipient = await prisma.recipient.findUniqueOrThrow({ where: { id: recipient.id } });

    expect(consentedRecipient.electronicConsentAt).not.toBeNull();

    // Consent is idempotent.
    const repeatConsent = await signingPost(request, apiToken, 'consent', { token: signingToken });

    expect(repeatConsent.ok()).toBeTruthy();
    expect(new Date((await repeatConsent.json()).electronicConsentAt).getTime()).toBe(
      consentedRecipient.electronicConsentAt?.getTime(),
    );

    // 3. Record the view with forwarded signer metadata via headers.
    const viewResponse = await signingPost(
      request,
      apiToken,
      'view',
      { token: signingToken },
      {
        'x-signer-ip-address': SIGNER_IP,
        'x-signer-user-agent': SIGNER_USER_AGENT,
      },
    );

    expect(viewResponse.ok(), await viewResponse.text()).toBeTruthy();

    const viewedRecipient = await prisma.recipient.findUniqueOrThrow({ where: { id: recipient.id } });

    expect(viewedRecipient.readStatus).toBe(ReadStatus.OPENED);

    // 3. Sign both fields with forwarded signer metadata in the body.
    const signTextResponse = await signingPost(request, apiToken, 'field/sign', {
      token: signingToken,
      fieldId: textField.id,
      fieldValue: { type: FieldType.TEXT, value: 'Hello from the native client' },
      signer: { ipAddress: SIGNER_IP, userAgent: SIGNER_USER_AGENT },
    });

    expect(signTextResponse.ok(), await signTextResponse.text()).toBeTruthy();

    const signSignatureResponse = await signingPost(request, apiToken, 'field/sign', {
      token: signingToken,
      fieldId: signatureField.id,
      fieldValue: { type: FieldType.SIGNATURE, value: 'Native Signer' },
      signer: { ipAddress: SIGNER_IP, userAgent: SIGNER_USER_AGENT },
    });

    expect(signSignatureResponse.ok(), await signSignatureResponse.text()).toBeTruthy();

    const signedField = await signSignatureResponse.json();

    expect(signedField.signedField.inserted).toBe(true);
    expect(signedField.signedField.signature.typedSignature).toBe('Native Signer');

    // 4. Status is still pending before completion.
    const pendingStatusResponse = await request.get(`${API_BASE_URL}/signing/status?token=${signingToken}`, {
      headers: authHeader(apiToken),
    });

    expect(pendingStatusResponse.ok()).toBeTruthy();
    expect((await pendingStatusResponse.json()).status).toBe('PENDING');

    // 5. Complete signing.
    const completeResponse = await signingPost(request, apiToken, 'complete', {
      token: signingToken,
      signer: { ipAddress: SIGNER_IP, userAgent: SIGNER_USER_AGENT },
    });

    expect(completeResponse.ok(), await completeResponse.text()).toBeTruthy();
    expect((await completeResponse.json()).status).toBe('SIGNED');

    // Completing again resolves idempotently.
    const repeatCompleteResponse = await signingPost(request, apiToken, 'complete', {
      token: signingToken,
    });

    expect(repeatCompleteResponse.ok(), await repeatCompleteResponse.text()).toBeTruthy();
    expect((await repeatCompleteResponse.json()).status).toBe('ALREADY_SIGNED');

    await expect(async () => {
      const dbEnvelope = await prisma.envelope.findUniqueOrThrow({
        where: { id: envelope.id },
        include: { recipients: true },
      });

      expect(dbEnvelope.recipients[0].signingStatus).toBe(SigningStatus.SIGNED);
      expect(dbEnvelope.status).toBe(DocumentStatus.COMPLETED);
    }).toPass();

    // 6. Audit log records the forwarded signer, not the test runner.
    const auditLogs = await prisma.documentAuditLog.findMany({
      where: {
        envelopeId: envelope.id,
        type: {
          in: [
            DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_OPENED,
            DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_FIELD_INSERTED,
            DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_COMPLETED,
          ],
        },
      },
    });

    expect(auditLogs.length).toBeGreaterThanOrEqual(5);

    for (const auditLog of auditLogs) {
      expect(auditLog.ipAddress).toBe(SIGNER_IP);
      expect(auditLog.userAgent).toBe(SIGNER_USER_AGENT);
    }
  });

  test('rejects a document and records the forwarded signer metadata', async ({ request }) => {
    const {
      envelope,
      token: apiToken,
      distributeResult,
    } = await apiSeedPendingDocument(request, {
      recipients: [{ email: 'native-rejecter@test.documenso.com', name: 'Native Rejecter' }],
    });

    const [recipient] = distributeResult.recipients;

    // Rejection does not require consent: a signer who never agreed to sign
    // electronically must still be able to decline.
    const rejectResponse = await signingPost(request, apiToken, 'reject', {
      token: recipient.token,
      reason: 'The totals are wrong',
      signer: { ipAddress: SIGNER_IP, userAgent: SIGNER_USER_AGENT },
    });

    expect(rejectResponse.ok(), await rejectResponse.text()).toBeTruthy();

    // The envelope moves to REJECTED once the rejection job has run, so the
    // status briefly reads PROCESSING right after the call.
    await expect(async () => {
      const statusResponse = await request.get(`${API_BASE_URL}/signing/status?token=${recipient.token}`, {
        headers: authHeader(apiToken),
      });

      expect((await statusResponse.json()).status).toBe('REJECTED');
    }).toPass();

    const rejectedLog = await prisma.documentAuditLog.findFirstOrThrow({
      where: {
        envelopeId: envelope.id,
        type: DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_REJECTED,
      },
    });

    expect(rejectedLog.ipAddress).toBe(SIGNER_IP);
    expect(rejectedLog.userAgent).toBe(SIGNER_USER_AGENT);
  });

  test('enforces recipient access authentication', async ({ request }) => {
    // Two factor access: viewing and field signing are allowed before the code is
    // entered (mirroring the signing page), but rejecting requires the code.
    const twoFactor = await apiSeedPendingDocument(request, {
      recipients: [{ email: 'native-2fa@test.documenso.com', name: 'Native 2FA' }],
      globalAccessAuth: ['TWO_FACTOR_AUTH'],
    });

    const [twoFactorRecipient] = twoFactor.distributeResult.recipients;

    const viewResponse = await signingPost(request, twoFactor.token, 'view', { token: twoFactorRecipient.token });

    expect(viewResponse.ok(), await viewResponse.text()).toBeTruthy();

    // Consent is allowed before the code is entered, like viewing.
    const consentResponse = await signingPost(request, twoFactor.token, 'consent', {
      token: twoFactorRecipient.token,
    });

    expect(consentResponse.ok(), await consentResponse.text()).toBeTruthy();

    const rejectWithoutCode = await signingPost(request, twoFactor.token, 'reject', {
      token: twoFactorRecipient.token,
      reason: 'No code supplied',
    });

    expect(rejectWithoutCode.status()).toBe(401);

    const rejectWithBadCode = await signingPost(request, twoFactor.token, 'reject', {
      token: twoFactorRecipient.token,
      reason: 'Bad code supplied',
      accessAuthOptions: { type: 'TWO_FACTOR_AUTH', token: '000000', method: 'email' },
    });

    expect(rejectWithBadCode.status()).toBe(401);

    const completeWithoutCode = await signingPost(request, twoFactor.token, 'complete', {
      token: twoFactorRecipient.token,
    });

    expect(completeWithoutCode.status()).toBe(401);

    // ACCOUNT access: can never be satisfied through the API.
    const account = await apiSeedPendingDocument(request, {
      recipients: [{ email: 'native-account@test.documenso.com', name: 'Native Account' }],
      globalAccessAuth: ['ACCOUNT'],
    });

    const [accountRecipient] = account.distributeResult.recipients;

    for (const path of ['view', 'reject', 'complete']) {
      const response = await signingPost(request, account.token, path, {
        token: accountRecipient.token,
        reason: 'Account gated',
      });

      expect(response.status(), `${path} should be unauthorised`).toBe(401);
    }

    const accountEnvelopeResponse = await request.get(
      `${API_BASE_URL}/signing/envelope?token=${accountRecipient.token}`,
      { headers: authHeader(account.token) },
    );

    expect(accountEnvelopeResponse.status()).toBe(401);
  });

  test('refuses invalid forwarded IP addresses and tokens from other teams', async ({ request }) => {
    const { token: apiToken, distributeResult } = await apiSeedPendingDocument(request, {
      recipients: [{ email: 'native-scoped@test.documenso.com', name: 'Native Scoped' }],
    });

    const [recipient] = distributeResult.recipients;

    const badIpResponse = await signingPost(request, apiToken, 'view', {
      token: recipient.token,
      signer: { ipAddress: 'not-an-ip' },
    });

    expect(badIpResponse.status()).toBe(400);

    // An API token from a different team cannot see or act on the signing token.
    const otherTeam = await apiCreateTestContext('e2e-other-team');

    const foreignEnvelopeResponse = await request.get(`${API_BASE_URL}/signing/envelope?token=${recipient.token}`, {
      headers: authHeader(otherTeam.token),
    });

    expect(foreignEnvelopeResponse.status()).toBe(404);

    const foreignCompleteResponse = await signingPost(request, otherTeam.token, 'complete', {
      token: recipient.token,
    });

    expect(foreignCompleteResponse.status()).toBe(404);
  });
});

import { describe, expect, it } from 'vitest';

import { ZCreateEnvelopeInputSchema, ZEnvelopeFileInputSchema } from './envelope-files';
import { ZConfirmSchema, ZListEnvelopesInputSchema } from './envelopes';
import { ZCreateDocumentFromTemplateInputSchema } from './templates';

describe('tool input schemas', () => {
  it('requires a literal true confirmation for destructive tools', () => {
    expect(ZConfirmSchema.safeParse(true).success).toBe(true);
    expect(ZConfirmSchema.safeParse(false).success).toBe(false);
    expect(ZConfirmSchema.safeParse('true').success).toBe(false);
    expect(ZConfirmSchema.safeParse(undefined).success).toBe(false);
  });

  it('bounds pagination and defaults the sort direction for list_envelopes', () => {
    expect(ZListEnvelopesInputSchema.parse({})).toEqual({ orderByDirection: 'desc' });
    expect(ZListEnvelopesInputSchema.safeParse({ perPage: 101 }).success).toBe(false);
    expect(ZListEnvelopesInputSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(ZListEnvelopesInputSchema.parse({ status: 'PENDING', hasExpiredRecipients: true })).toMatchObject({
      status: 'PENDING',
      hasExpiredRecipients: true,
    });
  });

  it('requires exactly one of base64 or url per file', () => {
    expect(ZEnvelopeFileInputSchema.safeParse({ name: 'a.pdf', base64: 'AAAA' }).success).toBe(true);
    expect(ZEnvelopeFileInputSchema.safeParse({ name: 'a.pdf', url: 'https://example.com/a.pdf' }).success).toBe(true);
    expect(ZEnvelopeFileInputSchema.safeParse({ name: 'a.pdf' }).success).toBe(false);
    expect(
      ZEnvelopeFileInputSchema.safeParse({ name: 'a.pdf', base64: 'AAAA', url: 'https://example.com/a.pdf' }).success,
    ).toBe(false);
  });

  it('defaults create_envelope to a DOCUMENT and needs at least one file', () => {
    const parsed = ZCreateEnvelopeInputSchema.parse({
      title: 'Roofing contract',
      files: [{ name: 'contract.pdf', base64: 'AAAA' }],
    });

    expect(parsed.type).toBe('DOCUMENT');
    expect(ZCreateEnvelopeInputSchema.safeParse({ title: 'x', files: [] }).success).toBe(false);
  });

  it('defaults create_document_from_template to a draft and validates recipient emails', () => {
    const parsed = ZCreateDocumentFromTemplateInputSchema.parse({
      templateId: 'envelope_abc',
      recipients: [{ id: 1, email: 'jane@example.com', name: 'Jane Doe' }],
    });

    expect(parsed.distribute).toBe(false);

    expect(
      ZCreateDocumentFromTemplateInputSchema.safeParse({
        templateId: 'envelope_abc',
        recipients: [{ id: 1, email: 'not-an-email' }],
      }).success,
    ).toBe(false);
  });
});

import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { extractAgentInput, jsonPart, parseAgentInput, textPart } from './messages';
import {
  ZAgentNameSchema,
  ZEventSchema,
  ZMessagePartSchema,
  ZMessageSchema,
  ZRunCreateRequestSchema,
  ZRunResumeRequestSchema,
} from './schemas';

describe('ACP wire schemas', () => {
  it('accepts RFC 1123 agent names and rejects others', () => {
    expect(ZAgentNameSchema.safeParse('envelope-sender').success).toBe(true);
    expect(ZAgentNameSchema.safeParse('Envelope').success).toBe(false);
    expect(ZAgentNameSchema.safeParse('-leading').success).toBe(false);
    expect(ZAgentNameSchema.safeParse('a'.repeat(64)).success).toBe(false);
  });

  it('defaults message part content type and encoding', () => {
    const part = ZMessagePartSchema.parse({ content: 'hello' });

    expect(part.content_type).toBe('text/plain');
    expect(part.content_encoding).toBe('plain');
  });

  it('rejects a part with both content and content_url', () => {
    const result = ZMessagePartSchema.safeParse({ content: 'x', content_url: 'https://example.com/a.pdf' });

    expect(result.success).toBe(false);
  });

  it('validates message roles', () => {
    expect(ZMessageSchema.safeParse({ role: 'user', parts: [{ content: 'x' }] }).success).toBe(true);
    expect(ZMessageSchema.safeParse({ role: 'agent/signing-status', parts: [{ content: 'x' }] }).success).toBe(true);
    expect(ZMessageSchema.safeParse({ role: 'system', parts: [{ content: 'x' }] }).success).toBe(false);
    expect(ZMessageSchema.safeParse({ role: 'user', parts: [] }).success).toBe(false);
  });

  it('defaults run mode to sync and requires at least one input message', () => {
    const request = ZRunCreateRequestSchema.parse({
      agent_name: 'signing-status',
      input: [{ role: 'user', parts: [{ content: '{}' }] }],
    });

    expect(request.mode).toBe('sync');

    expect(ZRunCreateRequestSchema.safeParse({ agent_name: 'signing-status', input: [] }).success).toBe(false);
  });

  it('requires a typed await_resume on resume', () => {
    expect(ZRunResumeRequestSchema.safeParse({ await_resume: { approved: true } }).success).toBe(false);
    expect(ZRunResumeRequestSchema.safeParse({ await_resume: { type: 'approval', approved: true } }).success).toBe(
      true,
    );
  });

  it('validates every event type', () => {
    const run = {
      agent_name: 'signing-status',
      run_id: '8f1c7e2a-4b7d-4c7a-9d0e-1a2b3c4d5e6f',
      status: 'created',
      output: [],
      created_at: new Date().toISOString(),
    };

    expect(ZEventSchema.safeParse({ type: 'run.created', run }).success).toBe(true);
    expect(ZEventSchema.safeParse({ type: 'message.part', part: { content: 'x' } }).success).toBe(true);
    expect(ZEventSchema.safeParse({ type: 'generic', generic: { status: 'cancelling' } }).success).toBe(true);
    expect(ZEventSchema.safeParse({ type: 'error', error: { code: 'invalid_input', message: 'bad' } }).success).toBe(
      true,
    );
    expect(ZEventSchema.safeParse({ type: 'run.cancelling', run }).success).toBe(false);
  });
});

describe('agent input extraction', () => {
  const schema = z.object({ envelopeId: z.string(), remind: z.boolean().optional() });

  it('reads an application/json part', () => {
    const input = parseAgentInput([{ role: 'user', parts: [jsonPart('input', { envelopeId: 'env_1' })] }], schema);

    expect(input).toEqual({ envelopeId: 'env_1' });
  });

  it('falls back to a text part containing JSON', () => {
    const input = parseAgentInput([{ role: 'user', parts: [textPart('{"envelopeId":"env_2"}')] }], schema);

    expect(input.envelopeId).toBe('env_2');
  });

  it('ignores agent messages and merges multiple JSON parts', () => {
    const { json } = extractAgentInput([
      { role: 'agent', parts: [jsonPart('x', { envelopeId: 'ignored' })] },
      { role: 'user', parts: [jsonPart('a', { envelopeId: 'env_3' }), jsonPart('b', { remind: true })] },
    ]);

    expect(json).toEqual({ envelopeId: 'env_3', remind: true });
  });

  it('attaches a base64 PDF part as input.pdf', () => {
    const pdfSchema = z.object({ pdf: z.object({ name: z.string(), base64: z.string() }) });

    const input = parseAgentInput(
      [
        {
          role: 'user',
          parts: [
            jsonPart('input', {}),
            { name: 'contract.pdf', content_type: 'application/pdf', content: 'JVBERi0=', content_encoding: 'base64' },
          ],
        },
      ],
      pdfSchema,
    );

    expect(input.pdf).toEqual({ name: 'contract.pdf', base64: 'JVBERi0=' });
  });

  it('surfaces schema failures as a 400 INVALID_BODY', () => {
    try {
      parseAgentInput([{ role: 'user', parts: [jsonPart('input', { remind: 'yes' })] }], schema);

      throw new Error('expected to throw');
    } catch (error) {
      const appError = AppError.parseError(error);

      expect(appError.code).toBe(AppErrorCode.INVALID_BODY);
      expect(appError.statusCode).toBe(400);
      expect(appError.userMessage).toContain('envelopeId');
    }
  });

  it('rejects malformed JSON parts', () => {
    expect(() =>
      parseAgentInput(
        [
          {
            role: 'user',
            parts: [
              jsonPart('input', 1).content
                ? { content_type: 'application/json', content: '{oops', content_encoding: 'plain' }
                : textPart(''),
            ],
          },
        ],
        schema,
      ),
    ).toThrowError(AppError);
  });
});

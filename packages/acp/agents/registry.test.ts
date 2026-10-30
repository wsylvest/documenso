import { describe, expect, it } from 'vitest';

import { ZAgentManifestSchema, ZAgentNameSchema } from '../protocol/schemas';
import { ZEnvelopeSenderInputSchema } from './envelope-sender';
import { ZRecipientSignerInputSchema } from './recipient-signer';
import { ACP_AGENTS, findAgent, getAgentOrThrow, toAgentManifest } from './registry';

describe('agent registry', () => {
  it('exposes the four launch agents with valid names', () => {
    expect(ACP_AGENTS.map((agent) => agent.name)).toEqual([
      'envelope-sender',
      'signing-status',
      'document-retrieval',
      'recipient-signer',
    ]);

    for (const agent of ACP_AGENTS) {
      expect(ZAgentNameSchema.safeParse(agent.name).success).toBe(true);
    }
  });

  it('produces spec-conformant manifests with an input JSON Schema', () => {
    for (const agent of ACP_AGENTS) {
      const manifest = toAgentManifest(agent);

      expect(ZAgentManifestSchema.safeParse(manifest).success).toBe(true);
      expect(manifest.metadata?.annotations?.input_schema).toBeTypeOf('object');
    }
  });

  it('looks agents up by name and throws 404 for unknown names', () => {
    expect(findAgent('signing-status')?.name).toBe('signing-status');
    expect(findAgent('nope')).toBeUndefined();
    expect(() => getAgentOrThrow('nope')).toThrowError(/not found/);
  });
});

describe('agent input schemas', () => {
  it('envelope-sender requires exactly one of templateId or pdf', () => {
    const recipients = [{ email: 'a@example.com' }];

    expect(ZEnvelopeSenderInputSchema.safeParse({ recipients }).success).toBe(false);
    expect(
      ZEnvelopeSenderInputSchema.safeParse({ recipients, templateId: 'tpl', pdf: { name: 'a', base64: 'AA==' } })
        .success,
    ).toBe(false);

    const parsed = ZEnvelopeSenderInputSchema.parse({ recipients, templateId: 'tpl' });

    expect(parsed.distribute).toBe(true);
    expect(parsed.requireApproval).toBe(false);
    expect(parsed.recipients[0].role).toBe('SIGNER');
  });

  it('recipient-signer defaults to the sign action and validates signer metadata', () => {
    const parsed = ZRecipientSignerInputSchema.parse({ token: 'abc' });

    expect(parsed.action).toBe('sign');
    expect(parsed.autoComplete).toBe(false);

    expect(ZRecipientSignerInputSchema.safeParse({ token: 'abc', signer: { ipAddress: 'not-an-ip' } }).success).toBe(
      false,
    );
    expect(ZRecipientSignerInputSchema.safeParse({ token: 'abc', action: 'dance' }).success).toBe(false);
  });
});

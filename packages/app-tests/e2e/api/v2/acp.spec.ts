import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { createApiToken } from '@documenso/lib/server-only/public-api/create-api-token';
import { prisma } from '@documenso/prisma';
import { seedPendingDocument } from '@documenso/prisma/seed/documents';
import { seedUser } from '@documenso/prisma/seed/users';
import { expect, test } from '@playwright/test';
import type { Team, User } from '@prisma/client';

/**
 * Agent Communication Protocol server at /api/acp.
 *
 * Requires `NEXT_PUBLIC_ACP_ENABLED=true` on the server under test; the suite
 * skips itself otherwise so the rest of the API project is unaffected.
 */

const WEBAPP_BASE_URL = NEXT_PUBLIC_WEBAPP_URL();
const baseUrl = `${WEBAPP_BASE_URL}/api/acp`;

type AcpRun = {
  run_id: string;
  agent_name: string;
  status: string;
  session_id: string | null;
  await_request: { type: string } | null;
  output: { role: string; parts: { name?: string; content_type: string; content?: string }[] }[];
  error: { code: string; message: string } | null;
};

type SseEvent = { id: string | null; event: string | null; data: unknown };

/**
 * Parse a buffered `text/event-stream` body into events.
 */
const parseSse = (body: string): SseEvent[] => {
  return body
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0 && !block.startsWith(':'))
    .map((block) => {
      const event: SseEvent = { id: null, event: null, data: null };
      const dataLines: string[] = [];

      for (const line of block.split('\n')) {
        if (line.startsWith('id:')) {
          event.id = line.slice(3).trim();
        } else if (line.startsWith('event:')) {
          event.event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim());
        }
      }

      event.data = dataLines.length > 0 ? JSON.parse(dataLines.join('\n')) : null;

      return event;
    });
};

const resultPart = (run: AcpRun) => {
  const part = run.output.at(-1)?.parts.find((candidate) => candidate.name === 'result');

  expect(part?.content, 'run output should contain a result part').toBeTruthy();

  return JSON.parse(part?.content ?? '{}') as Record<string, unknown>;
};

test.describe.configure({
  mode: 'parallel',
});

test.describe('ACP server', () => {
  let userA: User, teamA: Team, tokenA: string, userB: User, teamB: Team, tokenB: string;

  test.beforeAll(async ({ request }) => {
    const ping = await request.get(`${baseUrl}/ping`);

    test.skip(ping.status() === 404, 'ACP server is disabled (NEXT_PUBLIC_ACP_ENABLED is not "true")');
  });

  test.beforeEach(async () => {
    ({ user: userA, team: teamA } = await seedUser());
    ({ token: tokenA } = await createApiToken({
      userId: userA.id,
      teamId: teamA.id,
      tokenName: 'acp-userA',
      expiresIn: null,
    }));

    ({ user: userB, team: teamB } = await seedUser());
    ({ token: tokenB } = await createApiToken({
      userId: userB.id,
      teamId: teamB.id,
      tokenName: 'acp-userB',
      expiresIn: null,
    }));
  });

  test.describe('discovery', () => {
    test('lists agents without authentication and leaks nothing tenant specific', async ({ request }) => {
      const res = await request.get(`${baseUrl}/agents`);

      expect(res.ok()).toBeTruthy();

      const { agents } = (await res.json()) as { agents: { name: string; input_content_types: string[] }[] };

      expect(agents.map((agent) => agent.name)).toEqual([
        'envelope-sender',
        'signing-status',
        'document-retrieval',
        'recipient-signer',
      ]);

      expect(await res.text()).not.toContain(tokenA);

      const single = await request.get(`${baseUrl}/agents/signing-status`);

      expect(single.ok()).toBeTruthy();
      expect((await single.json()).metadata.annotations.input_schema).toBeTruthy();

      const missing = await request.get(`${baseUrl}/agents/does-not-exist`);

      expect(missing.status()).toBe(404);
      expect((await missing.json()).code).toBe('not_found');
    });

    test('serves the A2A agent card from the ACP mount and the domain root', async ({ request }) => {
      for (const url of [`${baseUrl}/.well-known/agent-card.json`, `${WEBAPP_BASE_URL}/.well-known/agent-card.json`]) {
        const res = await request.get(url);

        expect(res.ok(), url).toBeTruthy();

        const card = await res.json();

        expect(card.supportedInterfaces[0].protocolBinding).toBe('JSONRPC');
        expect(card.skills.map((skill: { id: string }) => skill.id)).toContain('envelope-sender');
      }
    });
  });

  test.describe('authentication', () => {
    test('rejects run operations without an API token', async ({ request }) => {
      const create = await request.post(`${baseUrl}/runs`, {
        data: { agent_name: 'signing-status', input: [{ role: 'user', parts: [{ content: '{}' }] }] },
      });

      expect(create.status()).toBe(401);
      expect((await create.json()).code).toBe('invalid_input');

      const get = await request.get(`${baseUrl}/runs/8f1c7e2a-4b7d-4c7a-9d0e-1a2b3c4d5e6f`);

      expect(get.status()).toBe(401);

      const rpc = await request.post(`${baseUrl}/a2a`, {
        data: { jsonrpc: '2.0', id: 1, method: 'GetTask', params: { id: '8f1c7e2a-4b7d-4c7a-9d0e-1a2b3c4d5e6f' } },
      });

      expect(rpc.status()).toBe(401);
    });

    test('rejects an invalid token', async ({ request }) => {
      const res = await request.post(`${baseUrl}/runs`, {
        headers: { Authorization: 'Bearer api_definitely_not_valid' },
        data: { agent_name: 'signing-status', input: [{ role: 'user', parts: [{ content: '{}' }] }] },
      });

      expect(res.status()).toBe(401);
    });
  });

  test.describe('runs', () => {
    test('runs signing-status synchronously and persists the run', async ({ request }) => {
      const document = await seedPendingDocument(userA, teamA.id, ['signer@test.documenso.com']);

      const res = await request.post(`${baseUrl}/runs`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: {
          agent_name: 'signing-status',
          mode: 'sync',
          input: [
            {
              role: 'user',
              parts: [{ content_type: 'application/json', content: JSON.stringify({ envelopeId: document.id }) }],
            },
          ],
        },
      });

      expect(res.ok(), await res.text()).toBeTruthy();
      expect(res.headers()['x-run-id']).toBeTruthy();

      const run = (await res.json()) as AcpRun;

      expect(run.status).toBe('completed');
      expect(run.agent_name).toBe('signing-status');
      expect(run.output).toHaveLength(1);
      expect(run.output[0].role).toBe('agent/signing-status');

      const result = resultPart(run);

      expect(result.envelopeId).toBe(document.id);
      expect(result.status).toBe('PENDING');
      expect(result.pendingRecipientIds).toEqual(document.recipients.map((recipient) => recipient.id));

      const persisted = await prisma.acpRun.findUniqueOrThrow({ where: { id: run.run_id }, include: { events: true } });

      expect(persisted.teamId).toBe(teamA.id);
      expect(persisted.userId).toBe(userA.id);
      expect(persisted.status).toBe('COMPLETED');
      expect(persisted.events.map((event) => event.type)).toEqual([
        'run.created',
        'run.in-progress',
        'message.created',
        'message.part',
        'message.part',
        'message.completed',
        'run.completed',
      ]);

      const fetched = await request.get(`${baseUrl}/runs/${run.run_id}`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      expect(fetched.ok()).toBeTruthy();
      expect(((await fetched.json()) as AcpRun).status).toBe('completed');

      const events = await request.get(`${baseUrl}/runs/${run.run_id}/events`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      expect(events.ok()).toBeTruthy();
      expect((await events.json()).events).toHaveLength(7);
    });

    test('streams run events as SSE', async ({ request }) => {
      const document = await seedPendingDocument(userA, teamA.id, ['signer@test.documenso.com']);

      const res = await request.post(`${baseUrl}/runs`, {
        headers: { Authorization: `Bearer ${tokenA}`, Accept: 'text/event-stream' },
        data: {
          agent_name: 'signing-status',
          mode: 'stream',
          input: [{ role: 'user', parts: [{ content: JSON.stringify({ envelopeId: document.id }) }] }],
        },
      });

      expect(res.ok(), await res.text()).toBeTruthy();
      expect(res.headers()['content-type']).toContain('text/event-stream');

      const runId = res.headers()['x-run-id'];

      expect(runId).toBeTruthy();

      const events = parseSse(await res.text());
      const types = events.map((event) => event.event);

      expect(types[0]).toBe('run.created');
      expect(types).toContain('run.in-progress');
      expect(types).toContain('message.completed');
      expect(types.at(-1)).toBe('run.completed');

      // Sequence ids are strictly increasing so clients can de-duplicate.
      const ids = events.map((event) => Number(event.id));

      expect(ids).toEqual([...ids].sort((a, b) => a - b));
      expect(new Set(ids).size).toBe(ids.length);

      const completed = events.at(-1)?.data as { run: AcpRun };

      expect(completed.run.run_id).toBe(runId);
      expect(completed.run.status).toBe('completed');
    });

    test('returns 202 immediately in async mode and reaches a terminal state', async ({ request }) => {
      const document = await seedPendingDocument(userA, teamA.id, ['signer@test.documenso.com']);

      const res = await request.post(`${baseUrl}/runs`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: {
          agent_name: 'signing-status',
          mode: 'async',
          input: [{ role: 'user', parts: [{ content: JSON.stringify({ envelopeId: document.id }) }] }],
        },
      });

      expect(res.status()).toBe(202);

      const run = (await res.json()) as AcpRun;

      expect(['created', 'in-progress', 'completed']).toContain(run.status);

      await expect
        .poll(
          async () => {
            const latest = await request.get(`${baseUrl}/runs/${run.run_id}`, {
              headers: { Authorization: `Bearer ${tokenA}` },
            });

            return ((await latest.json()) as AcpRun).status;
          },
          { timeout: 15_000 },
        )
        .toBe('completed');
    });

    test('fails the run, not the request, when the agent cannot find the envelope', async ({ request }) => {
      const res = await request.post(`${baseUrl}/runs`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: {
          agent_name: 'signing-status',
          input: [{ role: 'user', parts: [{ content: JSON.stringify({ envelopeId: 'does-not-exist' }) }] }],
        },
      });

      expect(res.status()).toBe(200);

      const run = (await res.json()) as AcpRun;

      expect(run.status).toBe('failed');
      expect(run.error?.code).toBe('not_found');
    });

    test('validates the request body', async ({ request }) => {
      const res = await request.post(`${baseUrl}/runs`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: { agent_name: 'Not Valid', input: [] },
      });

      expect(res.status()).toBe(400);

      const body = await res.json();

      expect(body.code).toBe('invalid_input');
      expect(body.data.code).toBe('SCHEMA_FAILED');
    });

    test('replays an idempotent request and isolates runs per team', async ({ request }) => {
      const document = await seedPendingDocument(userA, teamA.id, ['signer@test.documenso.com']);

      const payload = {
        agent_name: 'signing-status',
        input: [{ role: 'user', parts: [{ content: JSON.stringify({ envelopeId: document.id }) }] }],
      };

      const first = await request.post(`${baseUrl}/runs`, {
        headers: { Authorization: `Bearer ${tokenA}`, 'Idempotency-Key': `acp-${document.id}` },
        data: payload,
      });

      expect(first.ok()).toBeTruthy();

      const second = await request.post(`${baseUrl}/runs`, {
        headers: { Authorization: `Bearer ${tokenA}`, 'Idempotency-Key': `acp-${document.id}` },
        data: payload,
      });

      expect(second.ok()).toBeTruthy();
      expect(second.headers()['idempotent-replayed']).toBe('true');
      expect(((await second.json()) as AcpRun).run_id).toBe(((await first.json()) as AcpRun).run_id);

      const runId = ((await first.json()) as AcpRun).run_id;

      const foreign = await request.get(`${baseUrl}/runs/${runId}`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      });

      expect(foreign.status()).toBe(404);

      // Team B cannot read team A's envelope through the agent either.
      const crossTenant = await request.post(`${baseUrl}/runs`, {
        headers: { Authorization: `Bearer ${tokenB}` },
        data: payload,
      });

      expect(((await crossTenant.json()) as AcpRun).status).toBe('failed');
    });

    test('cancels a run that is awaiting input', async ({ request }) => {
      const document = await seedPendingDocument(userA, teamA.id, ['signer@test.documenso.com']);

      // recipient-signer pauses for confirmation after the (empty) sign step.
      const res = await request.post(`${baseUrl}/runs`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: {
          agent_name: 'recipient-signer',
          input: [
            {
              role: 'user',
              parts: [{ content: JSON.stringify({ token: document.recipients[0].token, action: 'sign' }) }],
            },
          ],
        },
      });

      expect(res.ok(), await res.text()).toBeTruthy();

      const run = (await res.json()) as AcpRun;

      expect(run.status).toBe('awaiting');
      expect(run.await_request?.type).toBe('confirmation');

      const wrongType = await request.post(`${baseUrl}/runs/${run.run_id}`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: { await_resume: { type: 'approval', approved: true } },
      });

      expect(wrongType.status()).toBe(409);

      const cancel = await request.post(`${baseUrl}/runs/${run.run_id}/cancel`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      expect(cancel.status()).toBe(202);

      await expect
        .poll(async () => {
          const latest = await request.get(`${baseUrl}/runs/${run.run_id}`, {
            headers: { Authorization: `Bearer ${tokenA}` },
          });

          return ((await latest.json()) as AcpRun).status;
        })
        .toBe('cancelled');

      const again = await request.post(`${baseUrl}/runs/${run.run_id}/cancel`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      expect(again.status()).toBe(409);
    });

    test('resumes recipient-signer with a rejection decision', async ({ request }) => {
      const document = await seedPendingDocument(userA, teamA.id, ['signer@test.documenso.com']);

      const res = await request.post(`${baseUrl}/runs`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: {
          agent_name: 'recipient-signer',
          input: [{ role: 'user', parts: [{ content: JSON.stringify({ token: document.recipients[0].token }) }] }],
        },
      });

      const run = (await res.json()) as AcpRun;

      expect(run.status).toBe('awaiting');

      const resumed = await request.post(`${baseUrl}/runs/${run.run_id}`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: {
          await_resume: { type: 'confirmation', decision: 'reject', reason: 'Wrong address on the contract' },
          mode: 'sync',
        },
      });

      expect(resumed.ok(), await resumed.text()).toBeTruthy();

      const finished = (await resumed.json()) as AcpRun;

      expect(finished.status).toBe('completed');
      expect(resultPart(finished).action).toBe('reject');

      const recipient = await prisma.recipient.findUniqueOrThrow({ where: { id: document.recipients[0].id } });

      expect(recipient.signingStatus).toBe('REJECTED');
      expect(recipient.rejectionReason).toBe('Wrong address on the contract');
    });
  });

  test.describe('A2A binding', () => {
    test('SendMessage creates a task and GetTask reads it back', async ({ request }) => {
      const document = await seedPendingDocument(userA, teamA.id, ['signer@test.documenso.com']);

      const send = await request.post(`${baseUrl}/a2a`, {
        headers: { Authorization: `Bearer ${tokenA}`, 'A2A-Version': '1.0' },
        data: {
          jsonrpc: '2.0',
          id: 'req-1',
          method: 'SendMessage',
          params: {
            message: {
              messageId: 'msg-1',
              role: 'ROLE_USER',
              parts: [{ data: { envelopeId: document.id } }],
              metadata: { skill: 'signing-status' },
            },
          },
        },
      });

      expect(send.ok(), await send.text()).toBeTruthy();

      const { result, error } = await send.json();

      expect(error).toBeUndefined();
      expect(result.status.state).toBe('TASK_STATE_COMPLETED');
      expect(result.artifacts[0].parts.some((part: { data?: unknown }) => part.data)).toBeTruthy();

      const get = await request.post(`${baseUrl}/a2a`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: { jsonrpc: '2.0', id: 2, method: 'tasks/get', params: { id: result.id } },
      });

      expect((await get.json()).result.id).toBe(result.id);

      const unknown = await request.post(`${baseUrl}/a2a`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: { jsonrpc: '2.0', id: 3, method: 'DoesNotExist' },
      });

      expect((await unknown.json()).error.code).toBe(-32601);
    });
  });
});

import { describe, expect, it } from 'vitest';

import { listAgents } from '../agents/registry';
import {
  A2A_METHOD_ALIASES,
  a2aMessageToAcpInput,
  a2aPartToAcpPart,
  acpPartToA2aPart,
  acpRunToA2aTask,
  buildAgentCard,
  runStatusToTaskState,
} from './a2a';
import { jsonPart, textPart, urlPart } from './messages';
import type { TRun } from './schemas';

describe('A2A mapping', () => {
  it('maps every ACP status onto an A2A task state', () => {
    expect(runStatusToTaskState('created')).toBe('TASK_STATE_SUBMITTED');
    expect(runStatusToTaskState('in-progress')).toBe('TASK_STATE_WORKING');
    expect(runStatusToTaskState('cancelling')).toBe('TASK_STATE_WORKING');
    expect(runStatusToTaskState('awaiting')).toBe('TASK_STATE_INPUT_REQUIRED');
    expect(runStatusToTaskState('completed')).toBe('TASK_STATE_COMPLETED');
    expect(runStatusToTaskState('failed')).toBe('TASK_STATE_FAILED');
    expect(runStatusToTaskState('cancelled')).toBe('TASK_STATE_CANCELED');
  });

  it('accepts 1.0 PascalCase methods and 0.x aliases', () => {
    expect(A2A_METHOD_ALIASES.SendMessage).toBe('SendMessage');
    expect(A2A_METHOD_ALIASES['message/send']).toBe('SendMessage');
    expect(A2A_METHOD_ALIASES['tasks/get']).toBe('GetTask');
    expect(A2A_METHOD_ALIASES['tasks/cancel']).toBe('CancelTask');
  });

  it('converts parts in both directions', () => {
    expect(a2aPartToAcpPart({ text: 'hi' })).toMatchObject({ content_type: 'text/plain', content: 'hi' });
    expect(a2aPartToAcpPart({ data: { envelopeId: 'e' } })).toMatchObject({
      content_type: 'application/json',
      content: '{"envelopeId":"e"}',
    });
    expect(a2aPartToAcpPart({ raw: 'AAAA', mediaType: 'application/pdf', filename: 'a.pdf' })).toMatchObject({
      content_encoding: 'base64',
      content_type: 'application/pdf',
      name: 'a.pdf',
    });

    expect(acpPartToA2aPart(textPart('hello'))).toMatchObject({ text: 'hello' });
    expect(acpPartToA2aPart(jsonPart('result', { ok: true }))).toMatchObject({ data: { ok: true } });
    expect(acpPartToA2aPart(urlPart('a.pdf', 'application/pdf', 'https://x/y.pdf'))).toMatchObject({
      url: 'https://x/y.pdf',
      mediaType: 'application/pdf',
    });
  });

  it('reads the skill from message metadata', () => {
    const { agentName, input, contextId } = a2aMessageToAcpInput(
      {
        role: 'ROLE_USER',
        parts: [{ data: { envelopeId: 'env_1' } }],
        metadata: { skill: 'signing-status' },
        contextId: '2d4b9c0e-1f2a-4b3c-8d9e-0f1a2b3c4d5e',
      },
      listAgents(),
    );

    expect(agentName).toBe('signing-status');
    expect(contextId).toBe('2d4b9c0e-1f2a-4b3c-8d9e-0f1a2b3c4d5e');
    expect(input[0].role).toBe('user');
    expect(input[0].parts[0].content_type).toBe('application/json');
  });

  it('projects an awaiting run onto an input-required task with artifacts and history', () => {
    const run: TRun = {
      agent_name: 'envelope-sender',
      run_id: '8f1c7e2a-4b7d-4c7a-9d0e-1a2b3c4d5e6f',
      session_id: null,
      status: 'awaiting',
      await_request: {
        type: 'approval',
        message: { role: 'agent/envelope-sender', parts: [textPart('Approve?')] },
      },
      output: [{ role: 'agent/envelope-sender', parts: [jsonPart('result', { envelopeId: 'env_1' })] }],
      error: null,
      created_at: '2026-10-30T00:00:00.000Z',
      finished_at: null,
    };

    const task = acpRunToA2aTask(run, [{ role: 'user', parts: [textPart('{}')] }]);

    expect(task.id).toBe(run.run_id);
    expect(task.contextId).toBe(run.run_id);
    expect(task.status.state).toBe('TASK_STATE_INPUT_REQUIRED');
    expect(task.status.message?.parts[0]).toMatchObject({ text: 'Approve?' });
    expect(task.artifacts).toHaveLength(1);
    expect(task.artifacts[0].parts[0]).toMatchObject({ data: { envelopeId: 'env_1' } });
    expect(task.history).toHaveLength(2);
    expect(task.metadata.acp_status).toBe('awaiting');
  });

  it('builds an Agent Card with one skill per agent and a bearer security scheme', () => {
    const card = buildAgentCard({ webAppUrl: 'https://sign.example.com', version: '2.18.0' });

    expect(card.skills.map((skill) => skill.id)).toEqual(listAgents().map((agent) => agent.name));
    expect(card.supportedInterfaces[0]).toMatchObject({ protocolBinding: 'JSONRPC', protocolVersion: '1.0' });
    expect(card.securitySchemes.apiToken).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(card.capabilities.streaming).toBe(false);
    expect(JSON.stringify(card)).not.toMatch(/teamId|userId|api_[a-z0-9]{10,}/i);
  });
});

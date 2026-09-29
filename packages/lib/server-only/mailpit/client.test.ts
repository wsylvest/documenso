import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getMailpitMessage, listMailpitMessages, updateMailpitMessage } from './client';

test('Mailpit operations are scoped to one valid message and connection failures are safe', async (t) => {
  const previous = process.env.NEXT_PRIVATE_MAILPIT_URL;
  process.env.NEXT_PRIVATE_MAILPIT_URL = 'http://127.0.0.1:8025';
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = t.mock.method(globalThis, 'fetch', (url: URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(new Response('ok'));
  });
  try {
    await assert.rejects(updateMailpitMessage('', 'delete'));
    await assert.rejects(getMailpitMessage('../messages'));
    assert.equal(calls.length, 0);
    await updateMailpitMessage('test-id', 'delete');
    assert.equal(calls[0].init?.method, 'DELETE');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { ids: ['test-id'] });
    await updateMailpitMessage('test-id', 'unread');
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { ids: ['test-id'], read: false });
    fetchMock.mock.mockImplementation(() => Promise.reject(new Error('private connection details')));
    await assert.rejects(listMailpitMessages('', 0), /Cannot connect to Mailpit/);
    delete process.env.NEXT_PRIVATE_MAILPIT_URL;
    await assert.rejects(listMailpitMessages('', 0), /Mailpit is not configured/);
  } finally {
    if (previous === undefined) {
      delete process.env.NEXT_PRIVATE_MAILPIT_URL;
    } else {
      process.env.NEXT_PRIVATE_MAILPIT_URL = previous;
    }
  }
});

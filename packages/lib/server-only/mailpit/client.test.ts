import { expect, test, vi } from 'vitest';

import { getMailpitMessage, listMailpitMessages, updateMailpitMessage } from './client';

test('Mailpit operations are scoped to one valid message and connection failures are safe', async () => {
  const previous = process.env.NEXT_PRIVATE_MAILPIT_URL;
  process.env.NEXT_PRIVATE_MAILPIT_URL = 'http://127.0.0.1:8025';
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(new Response('ok'));
  });
  try {
    await expect(updateMailpitMessage('', 'delete')).rejects.toThrow();
    await expect(getMailpitMessage('../messages')).rejects.toThrow();
    expect(calls.length).toBe(0);
    await updateMailpitMessage('test-id', 'delete');
    expect(calls[0].init?.method).toBe('DELETE');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ ids: ['test-id'] });
    await updateMailpitMessage('test-id', 'unread');
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ ids: ['test-id'], read: false });
    fetchMock.mockImplementation(() => Promise.reject(new Error('private connection details')));
    await expect(listMailpitMessages('', 0)).rejects.toThrow(/Cannot connect to Mailpit/);
    delete process.env.NEXT_PRIVATE_MAILPIT_URL;
    await expect(listMailpitMessages('', 0)).rejects.toThrow(/Mailpit is not configured/);
  } finally {
    fetchMock.mockRestore();
    if (previous === undefined) {
      delete process.env.NEXT_PRIVATE_MAILPIT_URL;
    } else {
      process.env.NEXT_PRIVATE_MAILPIT_URL = previous;
    }
  }
});

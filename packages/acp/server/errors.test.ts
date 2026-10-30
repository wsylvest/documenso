import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { toAcpError } from './errors';

describe('toAcpError', () => {
  it('maps Zod errors to 400 invalid_input with issues', () => {
    const result = z.object({ agent_name: z.string() }).safeParse({});

    if (result.success) {
      throw new Error('expected failure');
    }

    const { status, body } = toAcpError(result.error);

    expect(status).toBe(400);
    expect(body.code).toBe('invalid_input');
    expect(body.data?.code).toBe(AppErrorCode.SCHEMA_FAILED);
    expect(body.data?.issues).toEqual([{ path: 'agent_name', message: 'Required' }]);
  });

  it('maps NOT_FOUND to 404 not_found', () => {
    const { status, body } = toAcpError(new AppError(AppErrorCode.NOT_FOUND, { message: 'Run x not found' }));

    expect(status).toBe(404);
    expect(body).toEqual({ code: 'not_found', message: 'Run x not found', data: { code: 'NOT_FOUND' } });
  });

  it('honours an explicit status code and keeps the Documenso code in data', () => {
    const { status, body } = toAcpError(
      new AppError(AppErrorCode.INVALID_REQUEST, { message: 'conflict', statusCode: 409 }),
    );

    expect(status).toBe(409);
    expect(body.code).toBe('invalid_input');
    expect(body.data?.code).toBe('INVALID_REQUEST');
  });

  it('maps UNAUTHORIZED to 401 and TOO_MANY_REQUESTS to 429', () => {
    expect(toAcpError(new AppError(AppErrorCode.UNAUTHORIZED, { statusCode: 401 })).status).toBe(401);
    expect(toAcpError(new AppError(AppErrorCode.TOO_MANY_REQUESTS, { statusCode: 429 })).status).toBe(429);
  });

  it('hides unknown errors behind a 500 server_error', () => {
    const { status, body } = toAcpError(new Error('db connection string leaked'));

    expect(status).toBe(500);
    expect(body.code).toBe('server_error');
    expect(body.message).toBe('Internal server error');
  });
});

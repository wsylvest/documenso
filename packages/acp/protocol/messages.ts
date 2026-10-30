import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import type { z } from 'zod';

import type { TMessage, TMessagePart } from './schemas';

export const JSON_CONTENT_TYPE = 'application/json';
export const TEXT_CONTENT_TYPE = 'text/plain';
export const PDF_CONTENT_TYPE = 'application/pdf';

export const textPart = (content: string, name?: string): TMessagePart => ({
  name,
  content_type: TEXT_CONTENT_TYPE,
  content,
  content_encoding: 'plain',
});

export const jsonPart = (name: string, value: unknown): TMessagePart => ({
  name,
  content_type: JSON_CONTENT_TYPE,
  content: JSON.stringify(value),
  content_encoding: 'plain',
});

export const base64Part = (name: string, contentType: string, data: Buffer | Uint8Array): TMessagePart => ({
  name,
  content_type: contentType,
  content: Buffer.from(data).toString('base64'),
  content_encoding: 'base64',
});

export const urlPart = (name: string, contentType: string, url: string): TMessagePart => ({
  name,
  content_type: contentType,
  content_url: url,
  content_encoding: 'plain',
});

export const agentMessage = (agentName: string, parts: TMessagePart[]): TMessage => {
  const now = new Date().toISOString();

  return {
    role: `agent/${agentName}`,
    parts,
    created_at: now,
    completed_at: now,
  };
};

const isJsonLike = (contentType: string) => contentType === JSON_CONTENT_TYPE || contentType.endsWith('+json');

const decodePartContent = (part: TMessagePart): string | null => {
  if (part.content === undefined) {
    return null;
  }

  if (part.content_encoding === 'base64') {
    return Buffer.from(part.content, 'base64').toString('utf8');
  }

  return part.content;
};

/**
 * Collect the JSON object an agent should act on from the input messages.
 *
 * The last `application/json` part wins; text parts that parse as JSON
 * objects are accepted as a fallback for clients that only send text. Binary
 * parts (for example `application/pdf`) are returned separately so agents
 * can attach them to the input.
 */
export const extractAgentInput = (messages: TMessage[]) => {
  let json: Record<string, unknown> | null = null;
  const binaryParts: TMessagePart[] = [];
  const textParts: string[] = [];

  for (const message of messages) {
    if (!message.role.startsWith('user')) {
      continue;
    }

    for (const part of message.parts) {
      if (part.content_url !== undefined) {
        continue;
      }

      if (isJsonLike(part.content_type)) {
        const content = decodePartContent(part);

        if (content === null) {
          continue;
        }

        try {
          const parsed: unknown = JSON.parse(content);

          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            json = { ...(json ?? {}), ...(parsed as Record<string, unknown>) };
          }
        } catch {
          throw new AppError(AppErrorCode.INVALID_BODY, {
            message: `Message part "${part.name ?? part.content_type}" is not valid JSON`,
            statusCode: 400,
          });
        }

        continue;
      }

      if (part.content_type.startsWith('text/')) {
        const content = decodePartContent(part);

        if (content === null) {
          continue;
        }

        textParts.push(content);

        const trimmed = content.trim();

        if (trimmed.startsWith('{') && json === null) {
          try {
            const parsed: unknown = JSON.parse(trimmed);

            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              json = parsed as Record<string, unknown>;
            }
          } catch {
            // Plain text that happens to start with a brace; ignore.
          }
        }

        continue;
      }

      if (part.content_encoding === 'base64' && part.content !== undefined) {
        binaryParts.push(part);
      }
    }
  }

  return { json, binaryParts, text: textParts.join('\n') };
};

/**
 * Validate the extracted JSON input against an agent's schema, surfacing a
 * 400 with the Zod issues on failure.
 */
export const parseAgentInput = <T extends z.ZodTypeAny>(messages: TMessage[], schema: T): z.infer<T> => {
  const { json, binaryParts } = extractAgentInput(messages);

  const candidate: Record<string, unknown> = { ...(json ?? {}) };

  const pdfPart = binaryParts.find((part) => part.content_type === PDF_CONTENT_TYPE);

  if (pdfPart && candidate.pdf === undefined && pdfPart.content !== undefined) {
    candidate.pdf = {
      name: pdfPart.name ?? 'document.pdf',
      base64: pdfPart.content,
    };
  }

  const result = schema.safeParse(candidate);

  if (!result.success) {
    throw new AppError(AppErrorCode.INVALID_BODY, {
      message: 'Agent input failed validation',
      statusCode: 400,
      userMessage: result.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; '),
    });
  }

  return result.data;
};

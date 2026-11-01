---
date: 2026-10-30
title: MCP Server - Technical Specification
---

## Summary

Add `@documenso/mcp` (`packages/mcp`), a Model Context Protocol server built on
`@modelcontextprotocol/sdk@1.32.1`, mounted at `/api/mcp` on the existing Hono server
(`apps/remix/server/router.ts`) over the Streamable HTTP transport, plus a `stdio` proxy binary
(`documenso-mcp`) for clients that cannot speak HTTP. Authentication is the API V2 team token model.
Every tool executes through the tRPC `appRouter` via a server-side caller whose context is built from the
incoming HTTP request, so `authenticatedMiddleware` (API token branch) runs unchanged and the same
`packages/lib/server-only` functions and permission checks as REST API V2 are used.

### Specification version targeted

- **MCP protocol revision `2025-11-25`** (the `LATEST_PROTOCOL_VERSION` of SDK 1.32.1; the SDK also
  negotiates `2025-06-18`, `2025-03-26`, `2024-11-05`). Features used from these revisions:
  - Streamable HTTP transport (POST JSON-RPC, optional SSE response, optional `Mcp-Session-Id`,
    `MCP-Protocol-Version` header).
  - Authorisation: OAuth 2.1 resource server semantics, RFC 9728 Protected Resource Metadata,
    `WWW-Authenticate` with `resource_metadata`, RFC 8707 resource indicators (the `resource` value in the
    metadata document is the canonical server URI).
  - Tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), `title`,
    structured tool output (`outputSchema` + `structuredContent`), `resource_link` content blocks.
  - Resources with URI templates (RFC 6570) and `resources/templates/list`.
  - Prompts with typed arguments.
  - Elicitation (`elicitation/create`) is **not** used server-to-client: destructive confirmation is
    carried by an explicit `confirm` tool parameter, which works with every client and with stateless
    operation. The design leaves room to add elicitation later for clients that advertise the capability.
- The `2026-07-28` revision (stateless, no `initialize`, `server/discover`, no `Mcp-Session-Id`) was
  reviewed. SDK 1.x does not implement it; stateless mode here already avoids per-session state so the
  migration later is confined to the transport layer.

## 1. Architecture

```
MCP client (Claude Desktop / Code / Cursor, agent)
   | Streamable HTTP, Authorization: Bearer api_...
   v
apps/remix/server/router.ts
   app.use('/api/mcp/*', cors + mcpRateLimitMiddleware)
   app.route('/api/mcp', mcpRoute)                 <- packages/mcp/src/server/hono.ts
   app.get('/.well-known/oauth-protected-resource[/api/mcp]', ...)
   |
   v
packages/mcp/src/server/hono.ts
   1. feature flag (NEXT_PUBLIC_MCP_ENABLED)
   2. origin validation (DNS rebinding)
   3. authenticateMcpRequest()  -> 401 + WWW-Authenticate on failure
   4. transport = stateless WebStandardStreamableHTTPServerTransport (or session lookup)
   5. server = createDocumensoMcpServer({ auth, trpcCaller, logger })
   6. transport.handleRequest(c.req.raw, { authInfo })
   |
   v
packages/mcp/src/server/tools/*.ts, resources.ts, prompts.ts
   -> ctx.caller.envelope.find(...)   (tRPC caller, API token branch of authenticatedMiddleware)
   -> lib server-only functions for the few routes without OpenAPI meta (teams, PDF resources)
```

### Package layout

```
packages/mcp/
  package.json                 @documenso/mcp, bin documenso-mcp
  tsconfig.json
  vitest.config.ts
  index.ts                     public exports (server factory, hono route, metadata helpers)
  bin/documenso-mcp.mjs        stdio launcher (tsx) -> src/stdio.ts
  src/
    constants.ts               MCP_SERVER_NAME, MCP_PATH, URI scheme, limits
    stdio.ts                   stdio <-> remote Streamable HTTP proxy
    server/
      hono.ts                  mcpRoute (Hono sub-app) + wellKnownRoute
      sessions.ts              in-memory session registry (session mode)
      origin.ts                validateMcpOrigin()
      auth/
        parse-bearer-token.ts  parseBearerToken(header) pure helper
        authenticate.ts        authenticateMcpRequest() -> McpAuth | 401 Response
        protected-resource-metadata.ts  RFC 9728 document + WWW-Authenticate builder
      context.ts               createMcpToolContext(): tRPC caller + lib identity
      mcp-server.ts            createDocumensoMcpServer(ctx): registers tools/resources/prompts
      tool-result.ts           ok()/fail() helpers, AppError -> tool error mapping
      audit.ts                 logMcpToolCall()
      tools/
        envelopes.ts           list/get/update/cancel/delete, audit logs
        templates.ts           list/get templates, create_document_from_template
        envelope-files.ts      create_envelope (base64/url), download_* (resource links)
        recipients-fields.ts   add/update recipients and fields
        distribution.ts        distribute, resend
        teams-folders.ts       list_teams, list_folders
        signing.ts             native Signing API tools
      resources.ts             documenso:// resources and templates
      prompts.ts               workflow prompts
  src/**/*.test.ts             Vitest unit tests
```

## 2. Transport

- `WebStandardStreamableHTTPServerTransport` from the SDK (Web `Request`/`Response`, so it plugs into
  Hono with `transport.handleRequest(c.req.raw, { authInfo })`).
- **Stateless (default)**: `sessionIdGenerator: undefined`. One transport and one `McpServer` instance
  per HTTP request; the server instance is closed when the response completes. No `Mcp-Session-Id` is
  issued. `GET /api/mcp` returns `405` (no standalone SSE stream without sessions). `DELETE` returns
  `405`.
- **Session mode** (`NEXT_PRIVATE_MCP_SESSIONS_ENABLED=true`): `sessionIdGenerator: randomUUID`.
  `initialize` creates a transport + server bound to the authenticated `apiTokenId` and stores it in an
  in-memory registry with an idle TTL (30 minutes). Subsequent requests must carry `Mcp-Session-Id`;
  the registry refuses (404) a session id presented with a different API token. `GET` opens the
  standalone SSE stream, `DELETE` closes the session. Sessions are process-local; multi-instance
  deployments must use stateless mode or sticky routing (documented).
- `enableJsonResponse: true`: POST responses are plain JSON (allowed by the spec; the server emits no
  server-initiated messages that would need an SSE stream). In session mode `GET` still opens the
  standalone SSE stream.
- Request body limit: SDK default 4 MiB raised to 16 MiB for `/api/mcp` so a base64 PDF (up to the
  `APP_DOCUMENT_UPLOAD_SIZE_LIMIT`) fits in `create_envelope`.
- No HTTP+SSE legacy endpoints.
- `Origin` validation (`origin.ts`): if the header is present it must equal the origin of
  `NEXT_PUBLIC_WEBAPP_URL` or one of `NEXT_PRIVATE_MCP_ALLOWED_ORIGINS` (comma separated); otherwise
  `403 { error: 'invalid_origin' }`. Absent `Origin` is allowed (desktop clients and servers).
- CORS: `hono/cors` with `exposeHeaders: ['Mcp-Session-Id', 'MCP-Protocol-Version']`, mirroring
  `/api/v2`.

## 3. Authentication model

### Implemented: API tokens (identical to REST API V2)

1. `parseBearerToken(header)` accepts `Bearer api_x`, `api_x`, trims, and returns `null` when empty.
2. `authenticateMcpRequest(req)` calls `getApiTokenByToken({ token, bypassRateLimit: true })` (the per
   organisation API counter is incremented once per *tool call* by `authenticatedMiddleware`, not twice)
   and `assertUserNotDisabled`. The result is `McpAuth`:
   ```ts
   type McpAuth = {
     apiTokenId: number;
     user: { id: number; email: string; name: string | null };
     teamId: number;
     team: { id: number; name: string; url: string; organisationId: string };
   };
   ```
3. The SDK `AuthInfo` passed to the transport is `{ token: '<redacted>', clientId: 'api-token:<id>',
   scopes: ['documenso:team:<teamId>'], extra: { userId, teamId, apiTokenId } }`. The raw token is not
   kept on `AuthInfo`.
4. Tool execution builds a `TrpcContext` from the original `Request` (headers include the Authorization
   header), `session: null`, `metadata.source = 'apiV2'`, and calls procedures with
   `createCallerFactory(appRouter)`. Because every used procedure has `openapi` meta,
   `authenticatedMiddleware` takes the API branch: it re-resolves the token, sets `ctx.user`,
   `ctx.teamId = apiToken.teamId` and `metadata.auditUser` exactly as for REST. Audit logs written by
   lib functions therefore attribute actions to the token's team/user with no MCP-specific code.
5. Failure: `401` with
   `WWW-Authenticate: Bearer realm="documenso", error="invalid_token", error_description="...",
   resource_metadata="https://<host>/.well-known/oauth-protected-resource/api/mcp"` and JSON body
   `{ error: 'invalid_token', error_description }`.

### Implemented: OAuth 2.1 discovery documents (RFC 9728)

- `GET /.well-known/oauth-protected-resource` and `GET /.well-known/oauth-protected-resource/api/mcp`
  return:
  ```json
  {
    "resource": "https://sign.smartroofing.ai/api/mcp",
    "authorization_servers": [],
    "bearer_methods_supported": ["header"],
    "scopes_supported": [],
    "resource_name": "Documenso MCP",
    "resource_documentation": "https://sign.smartroofing.ai/docs/developers/mcp"
  }
  ```
  `authorization_servers` is populated from `NEXT_PRIVATE_MCP_AUTHORIZATION_SERVERS` when set.

### Explicitly out of scope: authorisation server and OAuth access-token validation

Implementing an OAuth 2.1 authorisation server (authorize/token endpoints, consent UI, PKCE, dynamic
client registration or Client ID Metadata Documents, refresh/revocation) is **not** part of this
work. The server is a pure *resource server*. Extension point: `authenticate.ts` has one branch for
`api_` tokens; a second branch for JWT access tokens (issuer from `NEXT_PRIVATE_MCP_AUTHORIZATION_SERVERS`,
JWKS validation with `jose`, audience `== resource`) would map the token to a Documenso user/team and
return the same `McpAuth` shape, leaving tools untouched. Until then clients that only speak OAuth will
read an empty `authorization_servers` list and must be configured with a static API token.

## 4. Tool execution context

```ts
type McpToolContext = {
  auth: McpAuth;
  caller: ReturnType<ReturnType<typeof createCallerFactory>>; // appRouter caller
  logger: Logger;           // pino child with { mcp: true, userId, teamId, apiTokenId }
  requestMetadata: RequestMetadata;
  baseUrl: string;          // NEXT_PUBLIC_WEBAPP_URL
};
```

`createCallerFactory` is exported from `packages/trpc/server/trpc.ts` (`t.createCallerFactory`). The
context's `res` is a throwaway `new Response()`; header mutations by the tRPC error formatter are ignored.

Routes without OpenAPI meta are **not** called through the caller (they would require a session). For
those the tool calls the lib function directly with `auth.user.id` / `auth.teamId`:
`getTeamById`, `findTeams`, `getEnvelopeById`, `getFileServerSide`, `generateCertificatePdf`,
`generateAuditLogPdf` (the same functions the Hono download route uses).

## 5. Tool catalogue

Naming: `snake_case`, deterministic registration order. Every tool declares `title`, `description`,
`inputSchema` (Zod with `.describe()`), `outputSchema` and `annotations`. Pagination inputs reuse
`ZFindSearchParamsSchema` (`query`, `page`, `perPage<=100`). Output schemas reuse the tRPC response
schemas so MCP output equals REST output.

| Tool | Backing procedure / function | Annotations (RO / D / I / OW) |
| --- | --- | --- |
| `list_envelopes` | `envelope.find` | RO, I |
| `get_envelope` | `envelope.get` | RO, I |
| `get_envelope_audit_logs` | `envelope.auditLog.find` | RO, I |
| `list_templates` | `envelope.find` with `type: TEMPLATE` | RO, I |
| `get_template` | `envelope.get` (asserts TEMPLATE) | RO, I |
| `list_folders` | `folder.findFolders` | RO, I |
| `list_teams` | `getTeamById` + `findTeams` (lib) | RO, I |
| `create_envelope` | `envelope.create` (FormData, base64 or URL PDF) | OW |
| `create_document_from_template` | `envelope.use` | OW |
| `update_envelope` | `envelope.update` | I |
| `add_recipients` | `envelope.recipient.createMany` | - |
| `update_recipients` | `envelope.recipient.updateMany` | I |
| `add_fields` | `envelope.field.createMany` | - |
| `update_fields` | `envelope.field.updateMany` | I |
| `distribute_envelope` | `envelope.distribute` | OW (sends email) |
| `resend_envelope` | `envelope.redistribute` | OW (sends email) |
| `cancel_envelope` | `envelope.cancel`, requires `confirm: true` | D |
| `delete_envelope` | `envelope.delete`, requires `confirm: true` | D |
| `download_envelope_pdf` | lib (`getEnvelopeById`, `getFileServerSide`) -> `resource_link` | RO, I |
| `download_certificate` | lib (`generateCertificatePdf`) -> `resource_link` | RO, I |
| `download_audit_log` | lib (`generateAuditLogPdf`) -> `resource_link` | RO, I |
| `signing_get_envelope` | `signing.getEnvelope` | RO, I |
| `signing_get_status` | `signing.getStatus` | RO, I |
| `signing_view` | `signing.view` | I |
| `signing_consent` | `signing.consent` | I |
| `signing_sign_field` | `signing.signField` | I |
| `signing_complete` | `signing.complete` | - |
| `signing_reject` | `signing.reject`, requires `confirm: true` | D |

RO = `readOnlyHint`, D = `destructiveHint`, I = `idempotentHint`, OW = `openWorldHint` (emails or
remote URL fetch). All non-RO tools carry `destructiveHint: false` unless marked D.

### Representative JSON schemas

`create_document_from_template` input:
```json
{
  "type": "object",
  "required": ["templateId"],
  "properties": {
    "templateId": { "type": "string", "description": "Envelope ID of the template (env_...)" },
    "recipients": { "type": "array", "items": { "type": "object", "required": ["id", "email"],
      "properties": { "id": { "type": "number" }, "email": { "type": "string" },
        "name": { "type": "string" }, "signingOrder": { "type": "number" } } } },
    "title": { "type": "string" }, "subject": { "type": "string" }, "message": { "type": "string" },
    "externalId": { "type": "string" }, "folderId": { "type": "string" },
    "prefillFields": { "type": "array", "items": { "$ref": "ZFieldMetaPrefillFieldsSchema" } },
    "distribute": { "type": "boolean", "description": "Send immediately" }
  }
}
```
Output: `{ envelopeId: string, status: DocumentStatus, recipients: [{ id, email, name, role, token?, signingUrl? }] }`.

`create_envelope` input: `{ title, type: 'DOCUMENT'|'TEMPLATE', files: [{ name, base64? , url? }],
recipients?, folderId?, externalId?, meta? }` (exactly one of `base64`/`url` per file; URL fetch is
limited to `http(s)`, 1 redirect, `APP_DOCUMENT_UPLOAD_SIZE_LIMIT`). Output: `{ envelopeId }`.

`download_envelope_pdf` input: `{ envelopeId, envelopeItemId?, version: 'signed'|'original', inline?:
boolean }`. Output `structuredContent`: `{ envelopeId, envelopeItemId, title, version, uri, sizeBytes,
mimeType, apiUrl }` and a `resource_link` content block pointing at
`documenso://envelope/{envelopeId}/item/{envelopeItemId}/pdf?version=signed`. Only when `inline: true`
is a `resource` block with `blob` (base64) appended.

Destructive tools: `confirm: z.literal(true)` in the input schema (described as "Must be true. Set only
after the user explicitly confirmed the action.").

## 6. Resources

Scheme `documenso://`. Templates are registered with `ResourceTemplate` and `list` callbacks where a
bounded listing exists.

| URI | MIME | Backing |
| --- | --- | --- |
| `documenso://envelope/{envelopeId}` | `application/json` | `envelope.get` |
| `documenso://template/{envelopeId}` | `application/json` | `envelope.get` (list: `envelope.find` TEMPLATE, first 50) |
| `documenso://envelope/{envelopeId}/item/{envelopeItemId}/pdf{?version}` | `application/pdf` (blob) | lib file read |
| `documenso://envelope/{envelopeId}/certificate` | `application/pdf` (blob) | `generateCertificatePdf` |
| `documenso://envelope/{envelopeId}/audit-log` | `application/pdf` (blob) | `generateAuditLogPdf` |

All resource reads are team scoped via the authenticated context.

## 7. Prompts

- `send_contract_to_homeowner(templateName?, homeownerName, homeownerEmail, propertyAddress?)`: guides
  the model to `list_templates`, pick the match, `create_document_from_template` with `distribute: true`,
  then report signing links.
- `check_signing_progress(envelopeId)`: `get_envelope`, summarise per recipient, suggest
  `resend_envelope` for pending recipients.
- `chase_unsigned_recipients(envelopeId)`: list pending recipients, confirm, then `resend_envelope`.

## 8. Error model

- Tool errors are returned as `{ isError: true, content: [{ type: 'text', text: 'CODE: message' }],
  _meta: { error: { code, message, status } } }`; `code` is the `AppErrorCode` when the cause is an
  `AppError` (unwrapped from `TRPCError.cause`), otherwise the tRPC error code. `structuredContent` is
  omitted on errors because SDK clients validate it against the output schema even for error results.
- Output schemas must convert to satisfiable JSON schemas: Zod intersections become `allOf` of closed
  objects, which nothing matches, so the audit log output uses a relaxed `passthrough` schema and the
  unit tests assert that no output schema contains `allOf`. Zod input validation is
  performed by the SDK before the handler runs (JSON-RPC `-32602`).
- Transport-level failures (auth, origin, disabled feature, rate limit) are HTTP responses, not JSON-RPC
  results: 401 (`invalid_token`), 403 (`invalid_origin`), 404 (`mcp_disabled`), 429 (rate limit with
  `Retry-After`, from the shared middleware).
- Confirmation missing on destructive tools fails schema validation (`confirm` must be literal `true`).

## 9. Rate limiting

- `mcpRateLimit = createRateLimit({ action: 'api.mcp', max: 300, window: '1m' })` per IP, applied as
  `createRateLimitMiddleware` on `/api/mcp/*` (DB backed, same as `/api/v2`).
- Per organisation API quota: incremented by `getApiTokenByToken` inside `authenticatedMiddleware` once
  per tool call (the MCP pre-auth call passes `bypassRateLimit: true` so `initialize`/`tools/list` are
  not counted against the organisation quota).

## 10. Audit logging

- `logMcpToolCall` writes one structured pino entry per tool call:
  `{ msg: 'mcp.tool', tool, userId, teamId, apiTokenId, envelopeId?, recipientId?, outcome: 'ok'|'error',
  code?, durationMs, requestId, sessionId? }`. Inputs are not logged except whitelisted identifiers;
  signing tokens and file contents are never logged.
- Business audit trail: unchanged `DOCUMENT_*` audit log events written by lib functions with
  `auditUser` from the API token (team name for team tokens). No new audit log type is introduced; a
  follow-up could add `source: 'mcp'` to `ApiRequestMetadata` if the certificate should show it.

## 11. Testing strategy

- **Unit (Vitest, `packages/mcp`)**: `parseBearerToken`, `buildProtectedResourceMetadata` and
  `buildWwwAuthenticateHeader`, `validateMcpOrigin`, `mapApiTokenToMcpAuth`/`toAuthInfo` (pure mapping
  from the `getApiTokenByToken` result shape), tool input schema validation (destructive `confirm`
  literal, `create_envelope` file union, pagination bounds), and an in-process round trip using the SDK
  `Client` + `InMemoryTransport` against `createDocumensoMcpServer` with a stubbed caller to verify
  `tools/list` annotations and structured output.
- **E2E (Playwright, `packages/app-tests/e2e/api/v2/mcp.spec.ts`)**: seeds a user/team/token with
  `apiCreateTestContext`, POSTs `initialize` + `notifications/initialized` + `tools/list` to `/api/mcp`
  with `Accept: application/json, text/event-stream`, calls `list_templates` (read-only) and
  `create_document_from_template` (create) and verifies the envelope in the DB; checks 401 +
  `WWW-Authenticate` without a token and the well-known document.
- Type checks: `npm run typecheck -w @documenso/remix`, `npx tsc --noEmit -p packages/mcp`.

## 12. Deployment and configuration

Environment variables (registered in `turbo.json` `globalEnv`, `packages/tsconfig/process-env.d.ts`,
`.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_MCP_ENABLED` | unset (off) | `true` enables `/api/mcp` and the well-known document |
| `NEXT_PRIVATE_MCP_SESSIONS_ENABLED` | unset (stateless) | `true` enables `Mcp-Session-Id` sessions (single instance only) |
| `NEXT_PRIVATE_MCP_ALLOWED_ORIGINS` | unset | extra allowed `Origin` values, comma separated |
| `NEXT_PRIVATE_MCP_AUTHORIZATION_SERVERS` | unset | issuer URLs advertised in RFC 9728 metadata |

Client configuration (see `apps/docs/content/docs/developers/mcp.mdx`): remote URL
`https://sign.smartroofing.ai/api/mcp` with header `Authorization: Bearer api_...`; or stdio via
`npx documenso-mcp` (from the repo) with `SR_SIGN_URL` and `SR_SIGN_API_TOKEN`.

Build: `@documenso/mcp` is added to `apps/remix` dependencies, the remix `tsconfig.json` paths and the
rollup `resolveOnly` list so the production server bundle includes it.

## 13. Open questions

1. Should the certificate page show "via MCP"? Requires a new `source` value on `ApiRequestMetadata`.
2. Session mode across multiple instances: a Redis-backed registry (BullMQ already brings ioredis) or
   stay stateless only.
3. Which OIDC provider will act as authorisation server for OAuth clients, and how do its subjects map to
   Documenso users and teams (user-scoped vs team-scoped tokens)?
4. Should `create_envelope` accept non-PDF files (DOCX conversion is available when
   `NEXT_PRIVATE_DOCUMENT_CONVERSION_URL` is set)? Current design accepts any file the REST API accepts.
5. Elicitation for destructive confirmation once major clients support it reliably.

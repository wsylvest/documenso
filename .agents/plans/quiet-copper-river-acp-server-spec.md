---
date: 2026-10-30
title: ACP Server - Technical Specification
---

## 0. Protocol research (verified 2026-10-30)

What was checked, and where:

- **ACP status.** `https://agentcommunicationprotocol.dev` carries the banner "ACP is now part of A2A under
  the Linux Foundation!" linking to the announcement at `https://github.com/orgs/i-am-bee/discussions/5`
  (posted 2025-08-25). The announcement states that "ACP is officially merging with the A2A under the Linux
  Foundation", that "the ACP team will be winding down active development", that IBM's Kate Blair joined
  the A2A Technical Steering Committee and that the BeeAI platform itself moved from ACP to A2A. No sunset
  date for the ACP spec or SDKs is given; the repo `i-am-bee/acp` and the Python/TypeScript SDKs remain
  available. Secondary reporting (safeguard.sh, rywalker.com) is consistent with this.
- **ACP REST surface.** Read from the OpenAPI document `i-am-bee/acp` `docs/spec/openapi.yaml` (main) and
  the Python reference server `python/src/acp_sdk/server/app.py` via Context7 (`/i-am-bee/acp`):
  - `GET /ping`, `GET /agents` (`limit`, `offset`), `GET /agents/{name}`, `POST /runs`, `GET /runs/{run_id}`,
    `POST /runs/{run_id}` (resume), `POST /runs/{run_id}/cancel` (202), `GET /runs/{run_id}/events`,
    `GET /session/{session_id}` (the Python server mounts `/sessions/{session_id}`; both are served here).
  - `RunMode`: `sync` | `async` | `stream`. `RunStatus`: `created`, `in-progress`, `awaiting`, `cancelling`,
    `cancelled`, `completed`, `failed` (terminal: completed, failed, cancelled).
  - `Message { role: 'user' | 'agent' | 'agent/{name}', parts: MessagePart[], created_at?, completed_at? }`.
    `MessagePart { name?, content_type (default text/plain), content?, content_encoding: 'plain' | 'base64',
    content_url?, metadata? }`; `content` and `content_url` are mutually exclusive.
  - `AgentManifest { name (RFC 1123 label, 1-63), description, input_content_types[], output_content_types[],
    metadata?, status? }`.
  - `Run { agent_name, run_id, session_id?, status, await_request?, output: Message[], error?, created_at,
    finished_at? }`. `RunCreateRequest { agent_name, input: Message[], session_id?, session?, mode? }`.
    `RunResumeRequest { run_id, await_resume, mode }`. The SDK's await payload is
    `MessageAwaitRequest { type: 'message', message }` / `MessageAwaitResume { type: 'message', message }`.
  - SSE `Event.type`: `message.created`, `message.part`, `message.completed`, `generic`, `run.created`,
    `run.in-progress`, `run.awaiting`, `run.completed`, `run.failed`, `run.cancelled`, `error`.
  - `Error { code: 'server_error' | 'invalid_input' | 'not_found', message, data? }`.
  - Known spec quirks: no event for `cancelling`; `/session/{session_id}` declares its path param as `name`.
- **A2A status and surface.** `https://a2a-protocol.org/latest/specification/`: latest release is **1.0.0**
  (previous 0.3.0). Agent Card is served at `/.well-known/agent-card.json` (section 8.2; `agent.json` is the
  pre-0.3 location and is served here as an alias). Required `AgentCard` fields: `name`, `description`,
  `supportedInterfaces[] { url, protocolBinding, protocolVersion }`, `version`, `capabilities`,
  `defaultInputModes`, `defaultOutputModes`, `skills`; `securitySchemes`/`security` optional. JSON-RPC
  method names in 1.0 are PascalCase (`SendMessage`, `SendStreamingMessage`, `GetTask`, `ListTasks`,
  `CancelTask`, `SubscribeToTask`, push-notification config methods, `GetExtendedAgentCard`); the 0.x wire
  names were `message/send`, `tasks/get`, `tasks/cancel`. `TaskState`: `TASK_STATE_SUBMITTED`, `WORKING`,
  `COMPLETED`, `FAILED`, `CANCELED`, `INPUT_REQUIRED`, `REJECTED`, `AUTH_REQUIRED`. `Part` in 1.0 has
  exactly one of `text`, `raw` (base64), `url`, `data`, plus `mediaType`, `filename`, `metadata` (the 0.x
  `kind` discriminator was removed, appendix A.2.1). Clients send `A2A-Version: 1.0`.

**Conclusion.** The ecosystem has converged on A2A; ACP is frozen but stable and still what BeeAI-era
clients speak. This server targets **ACP (OpenAPI on `i-am-bee/acp` main, 2025-08)** completely and serves
**A2A 1.0 discovery plus the three core task methods** (`SendMessage`, `GetTask`, `CancelTask`, with 0.x
aliases) from the same run core. Streaming for A2A (`SendStreamingMessage`) and push notifications are
left as follow-ups; the mapping is specified in section 7 so adding them is mechanical.

## 1. Architecture

```
apps/remix/server/router.ts
  app.use('/api/acp/*', cors(), acpRateLimitMiddleware)
  app.route('/api/acp', acp)                   // @documenso/acp Hono sub-app
  app.get('/.well-known/agent-card.json', ...) // A2A card alias at domain root (only when enabled)
  app.get('/.well-known/agent.json', ...)

packages/acp
  index.ts                      named export `acp` (Hono<HonoEnv>) and `isAcpEnabled`
  server/app.ts                 route table; all handlers are thin and call runs/* and agents/*
  server/auth.ts                resolveAcpPrincipal(): Bearer token -> { user, teamId, apiTokenId, metadata }
  server/errors.ts              AppError / ZodError -> ACP Error body + HTTP status
  server/sse.ts                 streamRunEvents(): SSE replay + live tail
  protocol/schemas.ts           Zod schemas for every ACP wire type (+ TS types)
  protocol/state-machine.ts     RunStatus transitions, terminal set, assertTransition()
  protocol/a2a.ts               Agent Card builder, ACP<->A2A mapping, JSON-RPC dispatcher
  runs/run-store.ts             Prisma persistence (AcpRun, AcpRunEvent), tenant-scoped
  runs/run-events.ts            in-process EventEmitter bus keyed by run id
  runs/run-executor.ts          executes one agent step, emits events, handles await/cancel/fail
  agents/types.ts               AgentDefinition, AgentStepContext, AgentStepResult
  agents/registry.ts            ordered list of agents + manifest projection
  agents/envelope-sender.ts
  agents/signing-status.ts
  agents/document-retrieval.ts
  agents/recipient-signer.ts
  *.test.ts                     Vitest (state machine, auth mapping, schemas, a2a mapping)
```

Design rules:

- The package depends on `@documenso/lib`, `@documenso/prisma` and `@documenso/trpc` (for the shared
  envelope creation caller and the field value schema) only. No React, no UI.
- Handlers never touch `prisma.envelope`, `prisma.recipient` or `prisma.field` for writes. The only Prisma
  writes in the package are to `AcpRun` and `AcpRunEvent`. Reads of recipients by token are limited to
  resolving `envelopeId` so that the team-scoped `getEnvelopeById` can authorise the request.
- Agents are **resumable step functions**, not generators. A step receives `{ input, state, resume }` and
  returns either `{ type: 'completed', output }` or `{ type: 'awaiting', awaitRequest, state }`. State is
  JSON and persisted on the run, so a resume after a process restart re-enters the step with everything it
  needs. This is what makes `awaiting` durable without a job queue.

## 2. Agent manifests

All agents accept `application/json` (and `text/plain` carrying JSON) and emit `application/json`,
`text/plain`; `document-retrieval` also emits `application/pdf`. Manifest `metadata` carries
`framework: 'documenso'`, `programming_language: 'TypeScript'`, `natural_languages: ['en']`, `tags`,
`capabilities` and `annotations.input_schema` (JSON Schema generated from the Zod input schema with
`zod-to-json-schema`, already a transitive dependency via zod-openapi) so tool-calling LLMs can fill the
request without reading docs.

| name | purpose | await step |
| --- | --- | --- |
| `envelope-sender` | create a document from a template or an inline PDF, add recipients and fields, prefill, distribute | optional `approval` before distribution (`requireApproval: true`) |
| `signing-status` | status of an envelope, pending recipients, optional reminders | none |
| `document-retrieval` | sealed PDF, certificate, audit log as `content_url` or inline base64 | none |
| `recipient-signer` | native signing flow for a recipient token: status, view, ESIGN consent, sign fields, complete or reject | `consent` when consent is missing; `confirmation` before completion unless `autoComplete: true` |

Input schemas (summarised; the Zod schemas in each agent file are authoritative):

```ts
// envelope-sender
{
  title?: string;
  templateId?: string;                 // envelope ID of a template (preferred)
  pdf?: { name: string; base64: string }; // or a message part with content_type application/pdf, base64
  externalId?: string;
  recipients: { email; name?; role?: RecipientRole; signingOrder?; templateRecipientId?: number }[];
  fields?: { recipientEmail; type: FieldType; page; positionX; positionY; width; height; envelopeItemIndex?; fieldMeta? }[];
  prefillFields?: TFieldMetaPrefillFieldsSchema[];
  meta?: { subject?; message?; redirectUrl?; distributionMethod? };
  distribute?: boolean;                // default true
  requireApproval?: boolean;           // default false -> awaiting before send
}
// signing-status
{ envelopeId?: string; documentId?: number; remind?: boolean | number[] }
// document-retrieval
{ envelopeId?: string; documentId?: number; artifacts?: ('document' | 'certificate' | 'audit-log')[]; inline?: boolean }
// recipient-signer
{
  token: string;                        // recipient signing token
  action: 'status' | 'view' | 'consent' | 'sign' | 'complete' | 'reject';
  consent?: boolean;                    // record ESIGN consent before signing
  fields?: { fieldId: number; fieldValue: TSignEnvelopeFieldValue }[];
  reason?: string;                      // reject
  nextSigner?: { email; name };
  accessAuthOptions?: TRecipientAccessAuth; // two factor proof for complete/reject
  autoComplete?: boolean;               // skip the confirmation await after signing
  signer?: { ipAddress?: string; userAgent?: string }; // forwarded like the native signing API
}
```

Outputs are one `agent/<name>` message with a `text/plain` summary part and an `application/json` part
named `result`; `document-retrieval` adds one part per artefact (`content_url` or base64 `application/pdf`).

## 3. Run lifecycle and state machine

```
created ──► in-progress ──► completed
   │             │  ▲        failed
   │             │  │        cancelled
   │             ▼  │ (resume)
   │          awaiting ──────► cancelling ──► cancelled
   └──────────► cancelling (cancel before start)
in-progress ──► cancelling ──► cancelled
```

Allowed transitions (enforced by `assertTransition` and unit tested):

| from | to |
| --- | --- |
| created | in-progress, cancelling, failed |
| in-progress | awaiting, completed, failed, cancelling |
| awaiting | in-progress, cancelling, failed |
| cancelling | cancelled, failed |
| completed, failed, cancelled | (none) |

Each transition appends an `AcpRunEvent` (`run.<status>`; `cancelling` has no spec event, so a `generic`
event `{ generic: { status: 'cancelling' } }` is emitted) and publishes it on the in-process bus. Output
messages produce `message.created` / `message.part` / `message.completed` events.

Modes: `async` returns `202` with the run immediately after persisting it and scheduling the step.
`sync` awaits the step up to `NEXT_PRIVATE_ACP_SYNC_TIMEOUT_MS` (default 60 s) and returns the run in
whatever state it reached. `stream` returns `text/event-stream` and closes when the run reaches `awaiting`
or a terminal state. `X-Run-Id` header is set on every `POST /runs` response (matches the SDK's
`Headers.RUN_ID`).

Resume (`POST /runs/{id}`): the run must be `awaiting` and `await_resume.type` must equal the stored
`await_request.type`; the resume payload is stored on the run, status becomes `in-progress`, and the
agent step is invoked again with `{ state, resume }`.

Cancel: `POST /runs/{id}/cancel` on a non-terminal run sets `cancelling`, aborts the step's
`AbortSignal` and returns `202`. The executor transitions to `cancelled` when the step observes the signal
or when it finishes a side-effect-free section; a run already `awaiting` is cancelled immediately.

## 4. Persistence

```prisma
enum AcpRunStatus { CREATED IN_PROGRESS AWAITING CANCELLING CANCELLED COMPLETED FAILED }

model AcpRun {
  id             String       @id              // uuid v4 (ACP run_id is a UUID)
  agentName      String
  status         AcpRunStatus @default(CREATED)
  sessionId      String?
  idempotencyKey String?
  input          Json                          // Message[]
  output         Json                          // Message[]
  state          Json?                         // agent-private resumable state
  awaitRequest   Json?
  awaitResume    Json?
  error          Json?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  finishedAt     DateTime?
  userId         Int
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  teamId         Int
  team           Team         @relation(fields: [teamId], references: [id], onDelete: Cascade)
  apiTokenId     Int?
  apiToken       ApiToken?    @relation(fields: [apiTokenId], references: [id], onDelete: SetNull)
  events         AcpRunEvent[]
  @@unique([teamId, idempotencyKey])
  @@index([teamId, createdAt]) @@index([sessionId]) @@index([status])
}

model AcpRunEvent {
  id        String   @id @default(cuid())
  runId     String
  run       AcpRun   @relation(fields: [runId], references: [id], onDelete: Cascade)
  sequence  Int
  type      String
  payload   Json
  createdAt DateTime @default(now())
  @@unique([runId, sequence])
}
```

Back-relations `acpRuns AcpRun[]` are added to `User`, `Team` and `ApiToken`. Migration
`20261030120000_add_acp_runs` is generated with `prisma migrate diff` (the worktree has no `.env`, so
`prisma migrate dev` cannot reach a database; the SQL is identical). `packages/prisma/generated` is
git-ignored and is regenerated by `npm run prisma:generate`.

Sessions are not a table: `GET /sessions/{id}` returns `{ id, history: [run URIs] }` computed from runs
with that `sessionId` in the caller's team.

## 5. Streaming (SSE)

`server/sse.ts` uses `streamSSE` from `hono/streaming`. On connect it replays persisted events from the
requested offset (`len(events)` for resume streams, `0` for create streams), then subscribes to the bus
and forwards live events. Each SSE frame is `event: <type>` + `data: <Event JSON>` + `id: <sequence>`;
a heartbeat comment is written every 15 s. The stream ends after a `run.awaiting`, `run.completed`,
`run.failed` or `run.cancelled` event. Because the executor is in-process, replay plus live tail cannot
miss events; sequence numbers let a client de-duplicate.

## 6. Idempotency

`POST /runs` honours an `Idempotency-Key` header (also accepted as `input[0].parts[*].metadata`-free
top-level `idempotency_key` for clients that cannot set headers). The key is unique per team. A replay
with the same key and the same `agent_name` returns the existing run (`200`, header
`Idempotent-Replayed: true`); the same key with a different agent returns `invalid_input` (409).

## 7. Authentication and authorisation

`resolveAcpPrincipal(c)`:

1. Read `Authorization`; accept `Bearer api_...` and bare `api_...` exactly as `authenticatedMiddleware`.
2. `getApiTokenByToken({ token })` (hash lookup, expiry, disabled user/owner, organisation API limits).
3. `assertUserNotDisabled(apiToken.user)`.
4. Produce `{ user, teamId: apiToken.teamId, apiTokenId, metadata: ApiRequestMetadata }` where
   `metadata.source = 'apiV2'`, `metadata.auth = 'api'` and `auditUser` is the team for team tokens or
   the user otherwise - the same object API V2 passes down, so audit log attribution is identical.
5. Child logger: `{ auth: 'api', source: 'apiV2', path, userId, apiTokenId, acpAgent?, acpRunId? }`.

Unauthenticated: `GET /ping`, `GET /agents`, `GET /agents/{name}`, both agent card URLs. Everything else
returns `401` with `{ code: 'invalid_input', message, data: { code: 'UNAUTHORIZED' } }`.

Authorisation is delegated to the lib functions (`getEnvelopeById`/`getEnvelopeWhereInput` with
`buildTeamWhereQuery`, `sendDocument`, `createEnvelopeFields`, ...). `recipient-signer` resolves the
recipient token to an `envelopeId` and then calls `getEnvelopeById({ userId, teamId })` before any action,
so a token from another tenant is a `not_found`.

A2A: the JSON-RPC endpoint uses the same principal; the Agent Card advertises
`securitySchemes.apiToken = { type: 'http', scheme: 'bearer' }`.

## 8. A2A mapping

| ACP | A2A 1.0 |
| --- | --- |
| `GET /agents` | `AgentCard.skills[]` (`id = name`, `tags`, `inputModes`/`outputModes`) |
| `POST /runs` (async) | `SendMessage` with `message.metadata.skill = <agent name>` -> `Task` |
| `GET /runs/{id}` | `GetTask` |
| `POST /runs/{id}/cancel` | `CancelTask` |
| `POST /runs/{id}` (resume) | `SendMessage` with `message.taskId = <run id>` on an `INPUT_REQUIRED` task |
| `session_id` | `contextId` |
| `created` / `in-progress` / `awaiting` / `cancelling` | `TASK_STATE_SUBMITTED` / `WORKING` / `INPUT_REQUIRED` / `WORKING` |
| `completed` / `failed` / `cancelled` | `TASK_STATE_COMPLETED` / `FAILED` / `CANCELED` |
| `MessagePart text/plain` | `Part.text` |
| `MessagePart application/json` | `Part.data` |
| `MessagePart base64` | `Part.raw` + `mediaType` |
| `MessagePart content_url` | `Part.url` + `mediaType` |
| output messages | `Task.artifacts[]` (one artefact per message) + `Task.history` |

The Agent Card lists one `supportedInterfaces` entry: `{ url: <WEBAPP_URL>/api/acp/a2a, protocolBinding:
'JSONRPC', protocolVersion: '1.0' }`. `capabilities.streaming = false`, `pushNotifications = false`.
Method aliases `message/send`, `tasks/get`, `tasks/cancel` are accepted for 0.x clients.

## 9. Error model

HTTP status is derived from `AppError` via `AppError.toRestAPIError` and `statusCode`; the body is an ACP
`Error`. Only the three spec codes are used so conformant clients validate; the Documenso code is in
`data.code`:

| condition | status | code | data.code |
| --- | --- | --- | --- |
| Zod validation of body/query | 400 | invalid_input | SCHEMA_FAILED + `issues` |
| missing/invalid token | 401 | invalid_input | UNAUTHORIZED |
| disabled account, forbidden | 403 | invalid_input | FORBIDDEN / ACCOUNT_DISABLED |
| unknown agent/run/session | 404 | not_found | NOT_FOUND |
| resume on non-awaiting run, cancel on terminal run, idempotency conflict | 409 | invalid_input | INVALID_REQUEST |
| organisation or route rate limit | 429 | invalid_input | TOO_MANY_REQUESTS |
| anything else | 500 | server_error | UNKNOWN_ERROR |

Inside a run, agent failures do not fail the HTTP request: the run transitions to `failed` with
`run.error` set to the same shape and a `run.failed` event.

## 10. Rate limiting

`acpRateLimit = createRateLimit({ action: 'api.acp', max: 300, window: '1m' })` applied with
`createRateLimitMiddleware` to `/api/acp/*` in `router.ts`, in addition to the per-organisation API
limits enforced inside `getApiTokenByToken`. SSE connections count once at connect time.

## 11. Audit logging

- Request level: the Hono child logger (request id, IP, UA) is extended with the principal fields and
  `acpRunId`/`acpAgent`; one `info` line at request start and one at each run transition.
- Run level: `AcpRunEvent` rows are the durable protocol-level audit trail (who, which agent, when, what
  changed); `AcpRun.apiTokenId` links to the credential.
- Envelope level: every mutation goes through lib functions that write `DocumentAuditLog` with the
  `ApiRequestMetadata` built in section 7, so entries read "via API, token team X" exactly like REST.

## 12. Testing

- Vitest in `packages/acp` (`npm run test -w @documenso/acp`): state machine transitions and terminal
  detection; auth header parsing and principal mapping (mocking `getApiTokenByToken`); schema validation
  of runs/messages/parts and the agent inputs; ACP<->A2A mapping and JSON-RPC error codes.
- Playwright `packages/app-tests/e2e/api/v2/acp.spec.ts` (project `api`): discovery without auth,
  401 without token, `signing-status` sync run against a seeded pending document, `stream` run collecting
  SSE events, `GET /runs/{id}` and `/events`, idempotent replay, cross-team isolation, A2A card and
  `SendMessage`/`GetTask`.
- Not run here (no server available); the spec compiles under the app-tests tsconfig.

## 13. Deployment

- Env: `NEXT_PUBLIC_ACP_ENABLED` (`true` to mount), `NEXT_PRIVATE_ACP_SYNC_TIMEOUT_MS` (default 60000).
  Registered in `turbo.json`, `packages/tsconfig/process-env.d.ts`, `.env.example`.
- Migration applied with `npm run prisma:migrate-deploy` as part of the normal release.
- Single-process execution: a run that is `in-progress` when the process dies is marked `failed` by the
  sweep on boot (`markOrphanedRuns`, called from `index.ts` when enabled) so clients never wait forever.
- Horizontal scale follow-up: move `run-executor` into a BullMQ job and replace the in-process bus with a
  Postgres `LISTEN/NOTIFY` or Redis pub/sub adapter; the store/executor split is designed for that.

## 14. Open questions

1. Should runs be visible to every team member through the UI (an "Agent runs" table) or remain API-only?
2. Retention: delete `AcpRun` rows after N days (suggest 90) via the cron scheduler?
3. `recipient-signer` wraps the fork's native Signing API building blocks (`getSigningRecipient`,
   `assertSigningAccessAuth`, `consentToElectronicSigning`, `signEnvelopeField`,
   `completeDocumentWithToken`, `rejectDocumentWithToken`, `getEnvelopeSigningStatus`) and surfaces
   `ELECTRONIC_CONSENT_REQUIRED` as an `awaiting` step of type `consent` (resume `{ consented }`; a
   refusal rejects with `PAPER_COPY_REQUESTED_REJECTION_REASON`). Signer IP/user agent follow
   `resolveSignerRequestMetadata`: input `signer` wins over `X-Signer-IP-Address` / `X-Signer-User-Agent`
   headers, API callers only. Should the consent disclosure text itself be returned in the await message
   (versioned by `ELECTRONIC_CONSENT_DISCLOSURE_VERSION`) so integrations never show stale wording?
4. A2A `SendStreamingMessage` over SSE: trivial given `server/sse.ts`, but needs the 1.0 `StreamResponse`
   envelope; defer until a consumer asks.
5. Should `document-retrieval` presign S3 URLs for `content_url` instead of pointing at the authenticated
   `/api/v2` download routes? Current choice keeps the token requirement on every artefact fetch.

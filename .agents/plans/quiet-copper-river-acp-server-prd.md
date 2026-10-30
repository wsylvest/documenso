---
date: 2026-10-30
title: ACP Server - Product Requirements
---

## Summary

Expose the Documenso signing platform (SmartRoofing AI instance, https://sign.smartroofing.ai) as a set of
discoverable agents that other agents and orchestrators can invoke through the Agent Communication Protocol
(ACP) REST surface, with an Agent2Agent (A2A) Agent Card and JSON-RPC task methods served from the same core.
The server is a new workspace package `@documenso/acp` mounted at `/api/acp`, authenticated with the existing
API tokens, and scoped to the token's team exactly like API V2.

The companion technical specification is `quiet-copper-river-acp-server-spec.md`.

## Problem

SmartRoofing AI is building an agentic back office: CRM agents qualify leads, estimating agents produce
proposals, and a dispatch agent schedules work. Each of those agents eventually needs a contract or a
change order signed. Today the only programmatic surface is the REST API (V1, V2) which is designed for
deterministic integrations: the caller must know the envelope model, orchestrate a dozen calls, poll for
status, and build its own human-in-the-loop step when a person needs to approve a send or sign a document.

Agent frameworks (BeeAI, LangGraph, CrewAI, Google ADK, Microsoft Agent Framework) do not speak "Documenso
REST"; they speak agent protocols. ACP (IBM BeeAI, Linux Foundation) and A2A (Google, Linux Foundation) give
an agent a manifest to discover, a single `run`/`task` abstraction with streaming and an explicit
`awaiting` / `input-required` state for human intervention. Without a protocol-native surface every
orchestrator has to hand-roll the glue, and no two do it the same way.

## Users

1. **External agents and orchestrators** (BeeAI platform, A2A clients, generic LLM tool-callers) that
   discover the manifest, start a run with a typed message, stream events and collect artefacts.
2. **SmartRoofing AI's own CRM and estimating agents** that need to send a proposal for signature from a
   template, prefill fields from the estimate, and report back when it is signed.
3. **Human-in-the-loop approvers** (sales managers, homeowners signing through an assisted flow) who are
   represented in the protocol by the `awaiting` state: a run pauses, a person decides, the orchestrator
   resumes the run with their answer.
4. **Platform operators** who need every agent action attributed to a user, a team and an API token in the
   structured logs and in the envelope audit log.

## Goals

- G1. Full ACP REST surface: `GET /ping`, `GET /agents`, `GET /agents/{name}`, `POST /runs` (sync, async,
  stream), `GET /runs/{id}`, `POST /runs/{id}` (resume), `POST /runs/{id}/cancel`, `GET /runs/{id}/events`,
  `GET /sessions/{id}`, with SSE event streams and typed message parts.
- G2. A2A discovery (`/.well-known/agent-card.json`) and the A2A JSON-RPC task methods (`SendMessage`,
  `GetTask`, `CancelTask`, plus 0.x aliases) served by the same run core.
- G3. Four agents at launch: `envelope-sender`, `signing-status`, `document-retrieval`, `recipient-signer`.
- G4. Authentication identical to API V2: `Authorization: Bearer api_...`, validated by
  `getApiTokenByToken`, disabled-account checks, organisation rate limits, team scoping. Every run is
  attributed to the token's user and team, and every envelope mutation goes through the same
  `packages/lib/server-only` functions the REST API uses.
- G5. Durable runs: persisted in Postgres, resumable after `awaiting`, survivable across restarts for
  reads, idempotent creation with `Idempotency-Key`.
- G6. Observability: structured pino logs per request and per run transition, envelope audit log entries
  through the existing mechanisms, and DB-backed rate limiting.
- G7. Feature-flagged (`NEXT_PUBLIC_ACP_ENABLED`) so self-hosters are unaffected by default.

## Non-goals

- Running LLM inference inside Documenso. The agents are deterministic workflow agents over the signing
  domain; "intelligence" lives in the caller.
- A2A push notifications (webhooks) and the extended Agent Card. Existing Documenso webhooks cover the
  notification need.
- Multi-process run execution. Runs execute in the web process (like the `local` jobs provider); a
  BullMQ-backed executor is a follow-up.
- Session-level shared state beyond grouping runs by `session_id`.
- Replacing API V2. ACP is an additional surface.

## User stories

- US1. As an estimating agent I can `POST /runs` with `agent_name: envelope-sender`, a template ID, the
  customer's name and email and prefilled field values, and receive the envelope ID and the signing URL
  for each recipient.
- US2. As a sales manager I can require approval before anything is sent: the run enters `awaiting` with a
  summary of what will be sent, and my orchestrator resumes it with `{ approved: true }` after I click
  approve in the CRM.
- US3. As an orchestrator I can stream `run.*` and `message.part` events over SSE and show progress in real
  time, or poll `GET /runs/{id}` from a serverless function.
- US4. As a CRM agent I can ask `signing-status` who has not signed yet and ask it to send reminders.
- US5. As a document pipeline I can ask `document-retrieval` for the sealed PDF, the certificate and the
  audit log and receive them as artefact URIs (or inline base64).
- US6. As a kiosk/assisted-signing agent I can drive `recipient-signer` with a recipient token: view the
  document, sign fields, pause for the human's confirmation and complete or reject.
- US7. As an A2A client I can fetch the Agent Card and call `SendMessage` and `GetTask` without knowing
  ACP exists.
- US8. As an operator I can disable the surface with one environment variable and see every run in the
  database with the API token that created it.

## Security requirements

- S1. Discovery endpoints (`/ping`, `/agents`, agent card) are unauthenticated but return only static
  manifests; nothing tenant-specific.
- S2. All `/runs` and `/sessions` endpoints and the A2A JSON-RPC endpoint require a valid API token. Token
  validation reuses `getApiTokenByToken` (hashing, expiry, disabled user, organisation rate limits).
- S3. Runs are tenant-isolated: every read and write filters by the token's `teamId`. A run ID from another
  team yields `not_found`.
- S4. Agents never write envelopes, recipients or fields with raw Prisma. They call the `server-only`
  functions the REST API calls (`createEnvelope`/`createEnvelopeRouteCaller`, `createDocumentFromTemplate`,
  `createEnvelopeFields`, `sendDocument`, `resendDocument`, `getEnvelopeById`, `signFieldWithToken`,
  `completeDocumentWithToken`, `rejectDocumentWithToken`, `viewedDocument`), which enforce team membership,
  limits and audit logging.
- S5. `recipient-signer` only accepts recipient tokens whose envelope belongs to the API token's team.
- S6. Inline binary parts are size-limited (`NEXT_PUBLIC_DOCUMENT_SIZE_UPLOAD_LIMIT` for PDFs) and
  base64-validated; no `content_url` fetching from arbitrary hosts on the server side (SSRF).
- S7. Signer IP and user agent recorded on envelope audit entries come from the request unless the caller
  is an API token holder that supplies them explicitly (same rule as the fork's native signing API).
- S8. DB-backed rate limiting (`api.acp`) in addition to the organisation API limits.
- S9. Error responses never include stack traces or internal IDs beyond the resource the caller named.

## Success metrics

- M1. A BeeAI/ACP client SDK can list agents, run `signing-status` in sync mode and stream
  `envelope-sender` without custom code (manual verification with the Python `acp-sdk` client).
- M2. An A2A client can fetch the card and complete `SendMessage` -> `GetTask` for `signing-status`.
- M3. 100% of runs in the `AcpRun` table carry `userId`, `teamId` and `apiTokenId`.
- M4. p95 latency for `signing-status` sync runs under 500 ms on the SmartRoofing instance.
- M5. Zero envelope mutations from the ACP code path that bypass `packages/lib/server-only` (enforced by
  code review and by the absence of `prisma.envelope.update`/`create` in `packages/acp`).

## Rollout

1. Land behind `NEXT_PUBLIC_ACP_ENABLED=false` (default). Unit tests and e2e spec in CI.
2. Enable on the SmartRoofing staging instance; exercise with the CRM agent's sandbox token.
3. Enable on production (`sign.smartroofing.ai`) for a single team token; monitor `AcpRun` failure rate
   and the `api.acp` rate limit counters for one week.
4. Publish docs page `developers/acp`, announce to internal agent teams.
5. Follow-ups: BullMQ-backed executor for horizontal scale, A2A push notifications, run retention sweep.

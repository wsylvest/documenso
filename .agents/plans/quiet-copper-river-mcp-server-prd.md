---
date: 2026-10-30
title: MCP Server - Product Requirements
---

## Problem

SmartRoofing AI staff increasingly work from LLM clients (Claude Desktop, Claude Code, Cursor) and from
server-side agents that orchestrate customer workflows. Today, sending a roofing contract for signature
means leaving the assistant, opening https://sign.smartroofing.ai, picking a template, typing the
homeowner's details, sending, and later checking back for progress. Server-side agents have to hand-roll
HTTP calls against the REST API V2 and the fork's Signing API, re-implementing authentication, error
handling and pagination for every integration.

The Model Context Protocol (MCP) is the standard way these clients discover and call tools. Exposing the
Documenso fork as an MCP server lets any MCP-capable client operate the signing workflow directly, with
tool descriptions and schemas that the model can read, and with every action attributed to a real
Documenso user and team through the existing API token system.

## Users

1. **SmartRoofing AI staff using an LLM client** (Claude Desktop, Claude Code, Cursor). They want to say
   "send the standard roofing contract to Jane Doe at jane@example.com" and have the assistant find the
   template, create the document, send it and report the signing links. They configure the server once
   with the remote URL and a team API token.
2. **Server-side agents** (support bots, CRM automations, scheduled jobs) that run without a human in the
   loop. They need deterministic tools with structured output, idempotency hints and stable error codes,
   and they may drive the recipient signing flow from a custom UI through the fork's native Signing API.
3. **Documenso operators** of the SmartRoofing AI instance who must be able to switch the feature off,
   rate limit it, audit what was done through it and reason about its security posture.

## Goals

- Expose the signing workflow (templates, documents, recipients, fields, distribution, reminders, status,
  downloads, and the native Signing API) as MCP tools, resources and prompts.
- Remote-first: a Streamable HTTP endpoint at `/api/mcp` on the existing Hono server, so no extra process
  or deployment is required. A `stdio` entry point for clients that only speak stdio.
- Authentication and authorisation identical to REST API V2: team API tokens, the same
  `packages/lib/server-only` functions and the same permission checks. No new privilege path.
- Spec-compliant discovery: OAuth 2.1 Protected Resource Metadata (RFC 9728) and `WWW-Authenticate`
  challenges so clients that implement the MCP authorisation flow learn how to authenticate.
- Safe by default: read-only tools annotated as such, destructive tools require an explicit confirmation
  parameter, large binaries are returned as resources rather than inline base64.
- Observable: every tool call is logged with tool name, user, team and envelope (never tokens), and the
  underlying actions continue to write the existing `DOCUMENT_*` audit log events.

## Non-goals

- Implementing an OAuth 2.1 authorisation server (login UI, consent, token issuance, dynamic client
  registration). The server advertises resource metadata and leaves the authorisation server list as a
  configuration extension point.
- Session-cookie authentication for MCP. Only API tokens are accepted.
- Exposing administrative, billing, organisation-management or webhook-management tools.
- Replacing the embed SDKs or the hosted signing page for recipients.
- Supporting the deprecated HTTP+SSE transport.

## User stories

- As a staff member, I can ask my assistant to list the team's templates and pick the right one by name.
- As a staff member, I can create a document from a template with the homeowner's name and email, have it
  sent, and receive the signing link in the reply.
- As a staff member, I can ask "has the Smith contract been signed yet?" and get a per-recipient status.
- As a staff member, I can ask for a reminder to be sent to the recipients who have not signed.
- As a staff member, I can download the sealed PDF, the signing certificate and the audit log of a
  completed document as resources that my client can open or save.
- As a staff member, I can upload a one-off PDF (base64 from my client, or a URL) and send it for
  signature with recipients and fields.
- As an agent developer, I can drive a recipient's signing flow (read envelope, record consent, sign
  fields, complete or reject) from my own UI with the recipient's signing token.
- As an agent developer, I am never able to delete, cancel or reject anything without passing an explicit
  `confirm: true` parameter.
- As an operator, I can turn the endpoint off with one environment variable, and I can see rate limit
  headers and structured logs for every call.

## Security requirements

- Bearer API tokens only (`Authorization: Bearer api_...`). Tokens are validated by the same function the
  REST API uses (`getApiTokenByToken`), honouring expiry, disabled users and organisation API rate
  limits. Every tool runs under the token's user and team; nothing can target another team.
- Unauthenticated requests receive `401` with a `WWW-Authenticate: Bearer` header carrying
  `resource_metadata`, and `/.well-known/oauth-protected-resource` is served per RFC 9728.
- `Origin` header validation to defeat DNS rebinding: when present it must match the web app origin or an
  explicit allow list; non-browser clients that omit `Origin` are accepted.
- No legacy SSE transport. Streamable HTTP only, JSON or SSE responses.
- DB-backed rate limiting on `/api/mcp` in addition to the organisation API limits applied per tool call.
- Destructive tools (`delete_envelope`, `cancel_envelope`, `signing_reject`) require `confirm: true` and
  are annotated `destructiveHint: true`.
- Secrets never appear in logs, tool output or resource contents. Recipient signing tokens are returned
  only where the REST API already returns them (distribute/redistribute responses).
- The feature is disabled unless `NEXT_PUBLIC_MCP_ENABLED=true`.

## Success metrics

- A staff member can complete "find template, send to homeowner, report signing link" from Claude
  Desktop in a single conversation with no manual steps in the web app.
- 100% of MCP tool calls are attributable to a user id, team id and API token id in the structured logs.
- Zero tool paths that bypass `packages/lib/server-only` permission checks (verified in code review).
- E2E coverage: initialise, list tools, read-only tool and create tool over HTTP with an API token.
- Unit coverage for auth header parsing, protected resource metadata, origin validation, token to context
  mapping and tool input schemas.

## Rollout

1. Ship behind `NEXT_PUBLIC_MCP_ENABLED` (off by default). Merge with tests and docs.
2. Enable on the SmartRoofing AI instance, issue a dedicated team API token per staff member, and
   configure Claude Desktop / Claude Code / Cursor with the remote URL.
3. Monitor the `api.mcp` rate limit bucket and the `mcpTool` log entries for a week; tune limits.
4. Follow-up: evaluate an external OAuth 2.1 authorisation server (for example an OIDC provider) and
   fill in the advertised `authorization_servers` plus access-token validation at the extension point
   described in the technical specification.

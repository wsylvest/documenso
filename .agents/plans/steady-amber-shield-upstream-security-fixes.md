# Upstream security fixes (2026-10-31)

Branch: `fix/upstream-security-fixes` (local, from `main` at 33f54e94). Upstream compared: `upstream/main` at 503cd1aa1
(v2.21.1 plus 3 commits), 39 commits ahead of our merge base a1d4bec14. Nothing in this work was pushed.

## Method

1. Listed every upstream-only commit, scanned messages and diffs for security keywords, and read the server-side
   file list of each commit so a silent fix could not hide behind a feature title.
2. Checked the upstream project's published GitHub security advisories (one) and tested it against our live instance.
3. Cherry-picked code fixes with `-x` so the origin is recorded. Re-applied dependency bumps by hand to
   `package.json` and regenerated the lockfile, because upstream's lockfile hunks cannot apply over ours.
4. Ran `npm audit` before and after, with the repo's `min-release-age = 7` policy left in force.

## Advisory

- **GHSA-3494-9j87-fj64** (high, 7.5): unauthenticated read of admin user data via the `?_routes=` single-fetch
  parameter. Affects 2.17.0 and earlier. **Not affected.** Our admin layout enforces route middleware before any
  loader runs. Verified on the live site: the exploit URLs for users, site-settings, organisations, claims and stats
  all return a redirect with no data.

## Ported

| Upstream | Change | Result |
|---|---|---|
| f4105e47e (#3411) | A recipient who already signed (or rejected) can no longer reject. `rejectDocumentWithToken` throws `INVALID_REQUEST` unless the recipient is `NOT_SIGNED`. Our signing API, MCP `signing_reject` and ACP `recipient-signer` all call it. | Applied cleanly. |
| 63cdd96cb (#3416) | SSO client secret field uses a placeholder instead of putting asterisks in the input value. | Auto-merged over our edits to the same file; result reviewed. |
| 6e507679a (#3506) | playwright and `@playwright/test` and `@playwright/browser-chromium` 1.56.1 to 1.64.1, sharp to `^0.35.5`. | Re-applied by hand. Chromium 156 launches and renders a PDF on this host. |
| 2fa644956, 872450056 (#3430, #3448) | `@libpdf/core` ^0.5.1 to ^0.5.3. | Re-applied by hand. |

## Beyond upstream

`npm audit` found nodemailer advisories upstream has not taken yet (it is still on ^9). Twelve advisories, including
address-parser denial of service on recipient addresses and a cross-tenant SMTP credential disclosure through a
shared DNS cache (relevant because organisations can have their own email transports).

- nodemailer ^9.0.0 to **^10.2.1**. The only breaking change in 10.0.0 is Node 20 or newer, and we run Node 24.
  10.3.x exists but is inside the one-week release-age window, and 10.2.1 already contains every fix (affected
  range is 10.1.3 and earlier).
- Nodemailer 10 ships its own types and made `SentMessageInfo` and address inputs stricter, so
  `packages/email/transports/mailchannels.ts` was adapted: optional callback result, nested arrays and group
  addresses handled, envelope built from the real recipient lists. `@types/nodemailer` removed (redundant).
- Verified at runtime: a real SMTP send through nodemailer 10 reached Mailpit, and the MailChannels transport was
  exercised against a stubbed endpoint for nested/group/cc recipients and the failure path.

## Audit result

| Point in time | Critical | High | Moderate | Low | Total |
|---|---|---|---|---|---|
| Last night, after the first `npm audit fix` (main) | 0 | 11 | 8 | 8 | 27 |
| This morning, first audit today (new advisories published overnight, including 12 for nodemailer) | 0 | 14 | 22 | 8 | 44 |
| After this branch | 0 | 13 | 18 | 8 | 39 |

The overnight rise comes from newly published advisories, not from regressions. The remaining highs are the
deferred items below; none has a fix inside the release-age policy except `follow-redirects` and `joi`, which
become installable on 2026-11-01.

## Deliberately not ported

- **a166cabde** "support cross-site authentication in embeds" (#3429). A feature, not a fix. It makes embed session
  cookies `SameSite=None; Partitioned` and adds an origin-based CSRF middleware to compensate. It conflicts with our
  router and sign-in changes, and we do not use embedded authentication. Revisit only if embedded signing for
  third parties is wanted.
- **7ce827bae** keep passkeys when a user is disabled. Behaviour change, not a fix.
- **710ac662c**, **cd0cc5feb** report-to-disable accounts and the sender-disabled view. Features.
- **80823ede7** admin force-remove recipients. Feature.
- Everything else in the 39: i18n, docs, UI fixes, recipient grouping (#3319), embed signature persistence.
  None are security relevant. A full upstream merge is a separate job.

## Still open (deferred, with reasons)

| Item | Why deferred | Mitigation / next step |
|---|---|---|
| `follow-redirects` 1.16.1 and `joi` 18.3.0 | Patched versions (1.16.2 on 10-25, joi on 10-28) are newer than the repo's 7 day release-age policy. | Re-run `npm audit fix` on or after 2026-11-01. Do not weaken `min-release-age`. |
| `zod` (high, memory exhaustion validating oversized constrained collections) and the chain through zod-prisma-types, prisma-kysely, inngest, Plain SDK | The only fix is zod 4.6.6 or later. There is no 3.x patch. A 3 to 4 migration touches the whole codebase. | Request bodies are already capped at 30 MB by nginx. Plan the zod 4 migration as its own project. |
| `prisma` 6 to 7.10.1 (`@prisma/config`, `deepmerge-ts`) | Major version, new client generator and driver model. | Dedicated upgrade branch with a migration rehearsal on a copy of the database. |
| `adm-zip` via `inngest-cli` | Dev-time CLI, only used when running the Inngest dev server. We use the local jobs provider. | Accept, or drop `inngest-cli` from production installs. |
| `@modelcontextprotocol/sdk` flagged | Reported only through its zod dependency; no advisory exists for 1.32.1. | Follows the zod item. |
| Email package standalone `tsc` | 46 errors from missing Node typings in its own tsconfig, pre-existing and unrelated. App typecheck is clean. | Add `types: ["node"]` to that tsconfig separately. |

## Verification

- `npm run typecheck -w @documenso/remix`: 0 errors. `tsc --noEmit` for `packages/mcp` and `packages/acp`: 0 errors.
- Unit tests: lib 254, mcp 38, acp 51, all passing. Biome clean on changed files.
- The e2e suites were not run: they seed into the database named in `.env`, which is production here.

# Rebrand Documenso to SR Sign: inventory and plan

Branch: `feat/rebrand-sr-sign` (created from `main` at 33f54e94, no source changes yet).
Date: 2026-10-31. Status: proposed, awaiting the decisions in section 4.

## 1. Recommendation in one paragraph

Rename everything a user, recipient, integrator or auditor can see. Leave internal identifiers
alone, above all the `@documenso/*` npm scope (1,638 files). The scope is invisible to users, and
renaming it would turn every future upstream merge into hundreds of conflicts. This fork is 21
commits behind upstream and needs upstream security fixes, so merge ability is worth more than a
cosmetic scope rename. Do the visible rename in small phases behind a CI guard that stops "Documenso"
creeping back in from upstream merges.

## 2. Inventory

Counts are for tracked files, excluding `package-lock.json` and `packages/lib/translations`.
Categories overlap, so they do not sum to the total.

Total: **1,873 files, 9,694 lines** mention "documenso" in any case. Translations add 402 lines across
12 locales (14 English msgids).

| Category | Files | Lines | Notes |
|---|---|---|---|
| `@documenso/` package scope | 1,638 | 7,232 | Imports and every `package.json`. 19 workspace packages. Internal only. |
| "Documenso" product name (capitalised) | 228 | 830 | About 60 lines are visible strings in app, ui and email code. The rest is docs and comments. |
| `documenso.com` URLs and emails | 208 | 625 | Mostly docs, plus support, license and marketing links. |
| `documenso-` / `-documenso` identifiers | about 100 | about 360 | CSS class `documenso-branded`, Tailwind scale `documenso-*`, filenames, container and queue names. |
| Docker image refs `documenso/…`, `ghcr.io/documenso` | 48 | 177 | `.github/workflows/publish.yml`, docker docs, compose files. |
| `DOCUMENSO_` env and constants | 63 | 158 | Includes `NEXT_PRIVATE_DOCUMENSO_LICENSE_KEY` (10 files, 18 lines). |
| `github.com/documenso` | 38 | 91 | README, docs, upstream references. |
| Standalone lowercase word | 51 | 318 | Reserved URL list, tags, service names, `.env.example` defaults. |

Where the files are: `apps/remix` 523, `packages/trpc` 364, `packages/lib` 356, `packages/app-tests` 150,
`apps/docs` 135, `packages/ui` 67, `packages/ee` 52, `packages/email` 36, `packages/mcp` 27,
`packages/acp` 27, `packages/auth` 23, `docker` 14. Most of these are import lines only.

### 2.1 Visible strings still carrying the name (verified by grep)

- Account delete dialog, API token and webhook dialogs ("authenticate with the Documenso API", "URL for
  Documenso to send webhook events to").
- Sender selects in the envelope distribute and settings dialogs (`<SelectItem value="-1">Documenso</…>`).
- `apps/remix/app/routes/_share+/share.$slug.tsx`: page title, description, og and twitter tags
  ("I just signed with Documenso!").
- `articles.signature-disclosure.tsx` (lines 19 and 130): the ESIGN disclosure names Documenso as the
  service provider. **Legal text, see 3.3.**
- Org sign-in page ("Return to Documenso sign in page"), support page, expired-licence banner in `root.tsx`.
- Branding upsell and email-domain upsell sample senders.
- Admin licence card and banners: "Documenso License", "Your Documenso instance is using features…".
  These refer to Documenso Inc's real licence. **Keep.**
- `DocumensoLogo` attribution mark: signing pages, embeds, multisign, certificate and audit-log PDFs.
- API titles: `packages/api/v1/openapi.ts` ("Documenso API") and the v2 spec title ("Documenso v2 API").
- ACP and A2A: agent card `name: 'Documenso Signing'`, `organization: 'Documenso'`, token description,
  server name `'Documenso ACP server'`, `framework: 'documenso'`, tags `['documenso', …]`.
- MCP: `serverInfo.name = 'documenso'` (asserted in `e2e/api/v2/mcp.spec.ts:152`).

### 2.2 Contract surfaces (rename = breaking change for integrators)

- Webhook delivery header `X-Documenso-Secret` (`packages/lib/server-only/webhooks/execute-webhook-call.ts:40`).
- Outbound email headers `X-Documenso-Sender-User-Id`, `X-Documenso-Envelope-Id`, `X-Documenso-Team-Id`
  (`packages/lib/server-only/email/build-envelope-email-headers.ts`).
- OpenAPI titles, MCP `serverInfo`, A2A agent card name (clients may key off them).
- `X-Signer-IP-Address` and `X-Signer-User-Agent` are already neutral.

### 2.3 Runtime and host identifiers (state attached)

- Database `documenso`, role `sr-dbadmin` (smanage rows exist), `.env.example` defaults for bucket, SMTP user,
  Postgres user and db.
- Redis/BullMQ prefix `documenso` (`packages/lib/jobs/client/bullmq.ts:47`). Unused here (jobs provider is `local`).
- Host: systemd unit `documenso.service`, socket `/var/run/smanager/apps/documenso/app.sock`,
  `/etc/tmpfiles.d/documenso.conf`, SELinux fcontext on that path, smanage `WebDomain` proxy target and
  `Database` row, nginx vhost (rendered from smanage), SELinux module `documenso-nginx`.
- Cookies: no Documenso-named cookies found. `preferred-team-url` and `sessionId` are neutral.
- PDF producer/creator metadata: no Documenso strings found in `packages/lib/server-only` or `packages/signing`.
- Reserved team/org URL list includes `'documenso'` (`packages/lib/constants/teams.ts`).

### 2.4 Repo, CI and docs

- `.github/workflows/publish.yml` (40 mentions): builds and pushes `documenso/documenso-*` to Docker Hub and
  `ghcr.io/documenso/*`. `deploy.yml`, `e2e-tests.yml` and others reference upstream resources.
- `README.md` (30), `ARCHITECTURE.md` (17), `render.yaml` (`documenso-app`, `documenso-db`),
  `SECURITY.md`, `SIGNING.md`, `WRITING_STYLE.md`, `.well-known/`, `vendor/` shims, `.opencode/`.
- `apps/docs` (135 files). Not deployed on this host. Largest: kubernetes, backups, upgrades, troubleshooting,
  database, docker-compose pages (25 to 100 mentions each).
- Our own docs: `developers/api/signing.mdx`, `mcp.mdx`, `acp.mdx`, `docker/smartroofing/README.md`.

## 3. Do not rename (and why)

1. **Licences and notices.** `LICENSE` (AGPL-3.0) and `packages/ee/LICENSE` (Documenso Commercial License)
   keep their text and copyright holders. File headers and attribution stay.
2. **Enterprise licence references.** `NEXT_PRIVATE_DOCUMENSO_LICENSE_KEY`, "Documenso License" admin UI and
   `license.documenso.com` links refer to Documenso Inc's real licence service.
3. **Legal wording about the provider.** The signature disclosure and consent text must name the legal entity
   that actually provides the service (SmartRoofing AI), not either product name. Changing it requires
   counsel review and a bump of `ELECTRONIC_CONSENT_DISCLOSURE_VERSION` (CLAUDE.md rule) so the audit log
   records which text each recipient accepted. Existing consents stay valid for their recorded version.
4. **Upstream references.** `upstream` git remote, links to upstream docs and issues, and a credit line.
   Keep a visible "Built on Documenso (AGPL-3.0)" credit in README, the About/footer and the certificate
   "powered by" mark. The AGPL does not grant trademark rights, which is a reason to rename, not to hide
   provenance.
5. **The `@documenso/*` scope and its file, component, class and token names** (see decision D2).
6. **Database name `documenso`.** Invisible to users; renaming needs downtime and smanage updates for no gain.
7. **Redis prefix.** Changing it orphans queued BullMQ jobs if that provider is ever enabled.
8. **Lingui msgids in non-English catalogues.** Regenerated by `npm run translate`; only `en` is served.

**Licensing flag.** Renaming does not change licence obligations. `packages/ee` stays under Documenso's
Commercial License, which requires an agreement or Enterprise subscription for production use. Several
capabilities this instance uses sit behind that code or its claim gates (email domains, CSC signing,
limits). Confirm coverage before go-live. This is not legal advice.

## 4. Decisions needed

| # | Decision | Recommended default |
|---|---|---|
| D1 | Display name form | Product **SR Sign**, slug `sr-sign`, company stays **SmartRoofing AI**. Titles read "Sign In - SR Sign". Email sender name stays "SmartRoofing AI". |
| D2 | Rename the `@documenso/*` scope and internal names? | **No.** Keeps upstream merges cheap. If yes, see Phase 4 and budget a long freeze. |
| D3 | Webhook and email headers | Send both `X-Documenso-Secret` and `X-SR-Sign-Secret` for one release, then drop the old one. Same for the three email headers. |
| D4 | Machine-readable names (MCP serverInfo, A2A card, OpenAPI titles) | Rename to `sr-sign` / "SR Sign". Pre-1.0 integrators are internal. |
| D5 | Docs site `apps/docs` | Leave upstream pages as is, rename only our added pages, add a banner "SR Sign is based on Documenso". |
| D6 | CI publish workflows | Disable `publish.yml` and `deploy.yml` (they target Documenso's registries). Add a minimal workflow publishing to `ghcr.io/wsylvest/sr-sign` only when wanted. |
| D7 | GitHub repo rename `wsylvest/documenso` to `wsylvest/sr-sign` | Yes, after Phase 1. GitHub redirects old URLs; update `origin`. |
| D8 | Host rename window | Rename service and socket to `sr-sign` in one 5 minute window (Phase 5). Keep DB name. |
| D9 | Legal disclosure wording | Counsel reviews text naming SmartRoofing AI as provider before Phase 1 ships that file. |

## 5. Phases

Each phase is its own PR-sized commit series on `feat/rebrand-sr-sign`, merged to `main` when its gate passes.

### Phase 0: Guardrail first (small)
- Add `scripts/check-rebrand.mts`: fails when `git grep -iI documenso` finds a hit outside an allowlist
  file `scripts/rebrand-allowlist.txt` (path globs plus optional line patterns). Seed the allowlist with
  everything in section 3 and every line not yet migrated, then shrink it phase by phase.
- Wire it into `ci.yml` and `lint-staged` as a non-blocking warning first, blocking at the end of Phase 3.
- Gate: script runs green on the branch tip.

### Phase 1: Visible product name (app, email, PDFs)
- Introduce `PRODUCT_NAME = 'SR Sign'` and `COMPANY_NAME` in `packages/lib/constants/app.ts`; replace literals
  in the strings listed in 2.1 (keep licence strings and attribution).
- Share page meta, dialogs, sender selects, upsell samples, sign-in return link, support page, expired-licence
  banner wording (keep "Documenso" where it names the licence).
- Rename the attribution component to `PoweredByLogo` only if D2 is no; otherwise leave `DocumensoLogo`.
- Email templates and subjects: confirm none still say Documenso (the earlier branding pass covered most).
- Reserved URLs: add `sr-sign`, `srsign`; keep `documenso`.
- Signature disclosure and consent copy: only after D9, then bump `ELECTRONIC_CONSENT_DISCLOSURE_VERSION`.
- `npm run translate`, give each new British msgid an American `en` msgstr.
- Gate: `npm run lint`, `npm run typecheck -w @documenso/remix`, lib tests, plus a manual pass over: sign-in,
  signing page, completion email, certificate and audit-log PDFs, share page.

### Phase 2: Machine-readable surfaces
- Webhook header: add `X-SR-Sign-Secret` next to `X-Documenso-Secret` (D3); same for the email headers.
  Update `apps/docs` webhook page for both.
- OpenAPI v1 and v2 titles, MCP `serverInfo` (update `mcp.spec.ts:152`), ACP `framework`, tags, agent
  card, A2A organization and token description, ACP server name.
- Gate: package unit tests (`@documenso/mcp`, `@documenso/acp`, lib); live curl of `/api/v2/openapi.json`,
  `/api/mcp` initialize, `/.well-known/agent-card.json` after deploy.

### Phase 3: Repo, CI and docs
- Rewrite `README.md`: SR Sign overview, SmartRoofing deployment link, "Built on Documenso" credit, licence
  section. Trim upstream badges and Elestio/Render buttons.
- Disable or retarget workflows per D6. Remove or replace `render.yaml`.
- Docker labels and image names in `docker/Dockerfile` and `docker/smartroofing/compose.yml`.
- Our docs: rename in `signing.mdx`, `mcp.mdx`, `acp.mdx`, `docker/smartroofing/README.md`; add the banner to
  the docs index (D5).
- Update `CLAUDE.md`, `AGENTS.md`, `ARCHITECTURE.md` headers to say "SR Sign (fork of Documenso)".
- Repo rename and `git remote set-url origin` (D7).
- Gate: `check-rebrand` becomes blocking.

### Phase 4: Internal identifiers (only if D2 = yes; not recommended)
- Codemod `@documenso/` to `@sr-sign/` across 1,638 files, 19 `package.json` names, tsconfig paths, turbo
  filters, `npm run` filters in docs, Docker and CI. Regenerate `package-lock.json`.
- Rename `documenso-logo.tsx`, `DocumensoLogo`, class `documenso-branded`, Tailwind scale `documenso-*`.
- Cost: every upstream merge after this conflicts in import lines. Mitigate by re-running the codemod on the
  merged tree before resolving. Freeze other work during the change. Estimate: one long day plus a
  slow build and full e2e run on a separate database.
- Gate: clean install, typecheck, all unit tests, e2e on a scratch database.

### Phase 5: Host and runtime (maintenance window, needs root)
Order matters; total downtime about 5 minutes.
1. In smanage, UPDATE the `sign.smartroofing.ai` WebDomain `proxyPass` to
   `http://unix:/var/run/smanager/apps/sr-sign/app.sock:` via the change queue (the worker is a service now).
   nginx then returns 502 until step 3 finishes.
2. As `bills`, before touching the service: set
   `NEXT_PRIVATE_LISTEN_SOCKET="/var/run/smanager/apps/sr-sign/app.sock"` in `.env` and update
   `Description=` in the unit draft. The new service reads this at start.
3. Root:
   ```bash
   sudo systemctl disable --now documenso
   sudo sed -i "s#/documenso#/sr-sign#" /etc/tmpfiles.d/documenso.conf
   sudo mv /etc/tmpfiles.d/documenso.conf /etc/tmpfiles.d/sr-sign.conf
   sudo systemd-tmpfiles --create /etc/tmpfiles.d/sr-sign.conf
   sudo semanage fcontext -a -t httpd_var_run_t "/var/run/smanager/apps/sr-sign(/.*)?"
   sudo restorecon -Rv /run/smanager/apps/sr-sign
   sudo mv /etc/systemd/system/documenso.service /etc/systemd/system/sr-sign.service
   sudo systemctl daemon-reload && sudo systemctl enable --now sr-sign
   sudo rm -rf /run/smanager/apps/documenso
   sudo semanage fcontext -d "/var/run/smanager/apps/documenso(/.*)?"
   ```
4. Verify the vhost points at the new socket, then `curl` the site, MCP and ACP endpoints. Update `AGENTS.md`.
- Rollback: reverse the same steps; the old socket path and unit are recreated from this list.
- Database, role and Redis prefix are unchanged.

### Phase 6: Aftercare
- Memory note and `AGENTS.md` updated with the new names.
- Add to the upgrade runbook: after `git merge upstream/main`, run `npx tsx scripts/check-rebrand.mts` and fix
  new hits (upstream adds fresh "Documenso" strings in features and translations).

## 6. Verification and acceptance

- `git grep -iI documenso` returns only allowlisted paths; the allowlist is reviewed in the PR.
- No page, email, PDF, share card or API title shows "Documenso" except licence and attribution surfaces.
- Webhook consumers receive both headers during the transition window.
- Typecheck and unit suites pass; screenshots of sign-in, signing, completion email and certificate PDF attached
  to the PR; e2e run on a scratch database, never the production database.

## 7. Rollback

Phases 0 to 3 are ordinary commits: revert the merge on `main`, rebuild, restart. Phase 5 has its own reverse
steps above. Phase 4 is reverted by reverting the single codemod commit if it is kept isolated (do it as one
commit).

## 8. Effort

| Phase | Effort |
|---|---|
| 0 Guardrail | 0.5 day |
| 1 Visible names | 1 day plus counsel turnaround on legal text |
| 2 Machine surfaces | 0.5 day |
| 3 Repo, CI, docs | 1 day |
| 4 Scope rename (optional) | 1 to 2 days and a code freeze |
| 5 Host rename | 0.5 hour of root time |
| Phases 0 to 3 and 5 | about 3 days |

## 9. Open questions

- Preferred display capitalisation: "SR Sign", "sr-sign" or "SR-Sign" in user-facing text (D1).
- Should recipients see "SmartRoofing AI" or "SR Sign" in email subjects and the sealed-PDF footer?
- Any external integrators already using the webhook header or the OpenAPI document title?

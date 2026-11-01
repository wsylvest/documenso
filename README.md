# SR Sign

Electronic document signing for SmartRoofing AI, live at **https://sign.smartroofing.ai**.

SR Sign is a fork of [Documenso](https://github.com/documenso/documenso), the open-source DocuSign alternative,
licensed under the GNU AGPL-3.0. SmartRoofing AI is the operator; Documenso is the upstream project and remains
credited throughout. See [Licence and attribution](#licence-and-attribution).

## What this fork adds

- **SmartRoofing AI branding**: brand colours, logo, fonts, email templates, product name "SR Sign".
- **Native Signing API** under `/api/v2/signing/*`, so another application can run a recipient's signing flow without
  the hosted page or an iframe. See `apps/docs/content/docs/developers/api/signing.mdx`.
- **ESIGN consumer consent** recorded per recipient before signing, with a versioned disclosure and a paper-copy
  option, shown on the certificate.
- **Sealed PDF digests** (SHA-256) recorded in the completion audit event.
- **MCP server** (`/api/mcp`) and **ACP / A2A agent server** (`/api/acp`) so AI agents can operate the signing
  workflow with team API tokens. Each can be switched off for the whole instance or per organisation by a
  super-admin. See `apps/docs/content/docs/developers/mcp.mdx` and `acp.mdx`.
- **Self-hosted operations**: Unix-socket listener for a same-host reverse proxy, admin Mailpit inbox, Resend-backed
  email domains, admin-created users with a password, copyable organisation invite links, and unlocked
  capabilities on instances that run with billing disabled.

## Running it

Requirements: Node 24 or newer, npm 11.17 or newer, PostgreSQL.

```bash
npm ci
cp .env.example .env          # fill in the secrets; see AGENTS.md for this deployment's setup
npm run prisma:generate
npm run prisma:migrate-deploy
npm run dev                   # development server
npm run build -w @documenso/remix && npm run start -w @documenso/remix   # production
```

Production for SmartRoofing AI runs as a systemd service behind nginx on a Unix socket; the deployment bundle for a
container-based setup is in [`docker/smartroofing`](docker/smartroofing). Day-to-day conventions, commands and this
machine's local setup are in [`AGENTS.md`](AGENTS.md), the architecture in [`ARCHITECTURE.md`](ARCHITECTURE.md),
and code style in [`CODE_STYLE.md`](CODE_STYLE.md).

Checks before merging: `npm run lint`, `npm run typecheck -w @documenso/remix`, `npm run test -w @documenso/lib`,
and `npm run check:rebrand`.

## Staying current with upstream

```bash
git fetch upstream
git log --oneline main..upstream/main      # review what is new
git merge upstream/main                    # or cherry-pick security fixes
npm run check:rebrand                      # upstream adds new "Documenso" strings; fix or allowlist them
```

Package names (`@documenso/*`) and internal identifiers deliberately stay as upstream's, so merges stay small. Only
user-visible names, public API names and operations are rebranded. The inventory and decisions behind this are in
`.agents/plans/calm-ruby-forge-rebrand-sr-sign.md`.

## Security

Report vulnerabilities privately to support@smartroofing.ai. Upstream's own policy is in [`SECURITY.md`](SECURITY.md).

## Licence and attribution

- Source is licensed under the [GNU AGPL-3.0](LICENSE). Anyone using the hosted service over a network is entitled to
  the corresponding source of the running version, which is this repository.
- `packages/ee` is under the [Documenso Commercial License](packages/ee/LICENSE). Production use of that code
  requires an agreement or Enterprise subscription with Documenso, Inc.
- **Built on Documenso.** Copyright holders and licence notices are preserved. "Documenso" is a trademark of
  Documenso, Inc.; SR Sign is an independent fork and is not endorsed by or affiliated with Documenso, Inc.

# sign.smartroofing.ai

Deployment bundle for the SmartRoofing AI signing instance: Caddy with automatic TLS in front of a Documenso container built from this fork, plus Postgres.

## First deploy

1. Point an `A` record for `sign.smartroofing.ai` at the host. Caddy needs ports 80 and 443 reachable to obtain its certificate.
2. Generate the document signing certificate on a workstation and copy only the `.p12` to the host:

   ```bash
   scripts/generate-signing-certificate.sh --org "SmartRoofing AI" \
     --common-name "SmartRoofing AI Document Signing" --email contracts@smartroofing.ai \
     --country US --out-dir ./out
   scp out/*.p12 host:/opt/smartroofing/secrets/smartroofing-ai-signing.p12
   ```

   For a trusted signature in Acrobat, replace this with a document-signing certificate from a CA on the Adobe Approved Trust List.

3. On the host:

   ```bash
   cd /opt/smartroofing/documenso/docker/smartroofing
   cp .env.example .env    # fill in every <SECRET>
   docker compose up -d --build
   docker compose logs -f documenso   # wait for "Starting Documenso server"
   ```

4. Sign in with the first admin account (create it with `npm run prisma:seed` equivalents or through the admin API), create the **SmartRoofing AI** organisation and team, then in **Admin → Organisations** confirm the claim shows unlimited members and teams.

## Provisioning a company

`POST /api/v2/provisioning/tenants` with `Authorization: Bearer <NEXT_PRIVATE_PROVISIONING_SECRET>` creates one company's service owner (no password), organisation, team, completion webhook and team API token, with the organisation defaults below applied. It is idempotent on `slug`; the token is returned once, on the call that issues it, and `rotateToken: true` issues a new one and revokes the old. `GET /api/v2/provisioning/tenants/{slug}` reports what exists (never a secret). With the variable blank the routes answer 404. Contract templates are still uploaded by the company's admin.

## Organisation defaults to set once

Organisation settings → Preferences:

- Branding on, company details and logo set, brand URL `https://smartroofing.ai`.
- Date format `MM/dd/yyyy hh:mm a`.
- Include signing certificate and audit log in sealed PDFs (on).
- Reply-to `support@smartroofing.ai`.

Contract templates:

- Access authentication **two factor email** on each homeowner recipient.
- A `{{signature, r1}}` placeholder or a placed signature field for every signer.
- State-mandated language such as the three-day right-to-cancel notice inside the PDF.

## Updating

```bash
git pull --ff-only
docker compose up -d --build documenso
```

Migrations run automatically on container start.

## Backups

Everything lives in two volumes: `database` (PDFs are stored in Postgres with `NEXT_PUBLIC_UPLOAD_TRANSPORT=database`) and `caddy_data`. Snapshot the host disk or `pg_dump` the database nightly, and keep the signing certificate and passphrase in your secret store, not only on the host.

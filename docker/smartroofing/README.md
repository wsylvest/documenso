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

## Branding

The application theme and assets are branded as SmartRoofing AI in the source tree (not through the per-organisation branding preferences, which stay editable in the UI). Values come from the live site (`https://smartroofing.ai/styles.css`: brand red `#e30516`, hover `#c40412`, slate `#6b7080`, Geist font) and its published assets (`/assets/logo.png`, `/favicon.png`).

| What | Where |
| --- | --- |
| Light/dark theme tokens (`--primary`, `--ring`, field cards, neutrals, `--new-primary-*` scale) | `packages/ui/styles/theme.css`, mirrored as hex in `packages/lib/constants/theme.ts` (also the default email palette) |
| `documenso-*` Tailwind colour scale (brand red) | `packages/tailwind-config/index.cjs` |
| Fonts (Geist, with Inter kept for PDF rendering) | `apps/remix/public/fonts/geist-*.ttf`, `apps/remix/app/app.css` |
| App logo and square mark | `apps/remix/app/components/general/branding-logo.tsx`, `branding-logo-icon.tsx` (render `packages/assets/logo.png` / `logo_icon.png`) |
| Documenso attribution mark ("Powered by", certificate "provided by") | `apps/remix/app/components/general/documenso-logo.tsx`, `apps/remix/public/static/documenso-logo.png` (used by the Konva certificate/audit-log renderers) |
| Favicons, PWA icons, manifest, Open Graph image, share frame | `apps/remix/public/` (`favicon*.png`, `favicon.ico`, `apple-touch-icon.png`, `android-chrome-*.png`, `site.webmanifest`, `opengraph-image.jpg`, `static/og-share-frame2.png`), duplicated in `packages/assets/` |
| Email logo | `apps/remix/public/static/logo.png` (served to mail clients) |
| Page titles and meta tags | `apps/remix/app/utils/meta.ts` (`APP_NAME`) |
| Product name in emails, invites, 2FA issuer, passkey relying party, sender-name default, support email fallback | `packages/email/templates/*`, `packages/lib/constants/{app,email}.ts`, `packages/lib/server-only/2fa/*`, `packages/lib/utils/authenticator.ts` |

The source logo is only published as a PNG (`573x423`); there is no vector version on the site, so the icon sizes are resampled from the site's own `favicon.png` and the 512px icon and Open Graph image are composed from `logo.png`. Replace `packages/assets/logo.png` and `apps/remix/public/static/logo.png` with an SVG-derived export when one is available.

## Updating

```bash
git pull --ff-only
docker compose up -d --build documenso
```

Migrations run automatically on container start.

## Backups

Everything lives in two volumes: `database` (PDFs are stored in Postgres with `NEXT_PUBLIC_UPLOAD_TRANSPORT=database`) and `caddy_data`. Snapshot the host disk or `pg_dump` the database nightly, and keep the signing certificate and passphrase in your secret store, not only on the host.

# Native dependency replacements

These CommonJS entry points support dependencies that still import deprecated
packages. They are installed as local aliases and selected by scoped npm
overrides; no deprecated implementation is installed.

- `plain-sdk-get`: replaces the three dot-separated lookups in
  `@team-plain/typescript-sdk@5.11.0` with optional chaining. It is not a
  general-purpose Lodash replacement. Remove it when Plain removes `lodash.get`,
  and review its callers when upgrading the SDK.
- `native-domexception`: exposes Node 24's native `DOMException` to `fetch-blob`.
  Remove it when `fetch-blob` no longer imports `node-domexception`.

The Docker install stages copy this directory so local aliases also resolve in
pruned installs. No Docker service is needed for development.

Run `node scripts/check-dependency-migrations.mts` after changing these packages
or their parents. OTP compatibility is covered by
`npm run test -w @documenso/lib -- server-only/2fa/otp.test.ts`.

# Agent Guidelines for Documenso

## Local Development (No Docker)

- Use the existing native PostgreSQL instance at `localhost:5432`, database `documenso`, with the local `bills` role. Connection URLs and generated secrets are in the ignored `.env`.
- Use `NEXT_PRIVATE_JOBS_PROVIDER="local"` and database upload storage; Redis is not required.
- Start the app with `npm run dev` on port 6300 and access it at https://docs.dnsgroup.com. The local `.env` sets `NEXT_PUBLIC_WEBAPP_URL="https://docs.dnsgroup.com"` for authentication and `NEXT_PRIVATE_INTERNAL_WEBAPP_URL="http://localhost:6300"` for internal requests. Do not use `npm run d`, `npm run dx`, or `npm run dx:up`; they invoke Docker.
- Apply migrations with `npm run prisma:migrate-deploy` and generate the client with `npm run prisma:generate`.
- Native email capture: `tmp/mailpit/mailpit --listen 127.0.0.1:8025 --smtp 127.0.0.1:2500 --smtp-auth-accept-any --smtp-auth-allow-insecure --database tmp/mailpit/mail.db --disable-version-check`. Inbox: http://localhost:8025. The binary and database are local, ignored files.
- Seeded development login: `admin@documenso.com` or `example@documenso.com`, password `password`. The initial seed has already run; avoid the general seed command, which also imports large test-data scripts.
- The local `.env` uses the bundled example signing certificate for development. DOCX conversion is not configured; use PDF uploads.

## Build/Test/Lint Commands

- `npm run build` - Build all packages
- `npm run lint` - Lint all packages
- `npm run lint:fix` - Auto-fix linting issues
- `npm run test:e2e` - Run E2E tests with Playwright
- `npm run test:dev -w @documenso/app-tests` - Run single E2E test in dev mode
- `npm run test-ui:dev -w @documenso/app-tests` - Run E2E tests with UI
- `npm run format` - Format code with Biome
- `npm run dev` - Start development server for Remix app

**Important:** Do not run `npm run build` to verify changes unless explicitly asked. Builds take a long time (~2 minutes). Use `npx tsc --noEmit` for type checking specific packages if needed.

## Code Style Guidelines

- Use TypeScript for all code; prefer `type` over `interface`
- Use functional components with `const Component = () => {}`
- Never use classes; prefer functional/declarative patterns
- Use descriptive variable names with auxiliary verbs (isLoading, hasError)
- Directory names: lowercase with dashes (auth-wizard)
- Use named exports for components
- Never use 'use client' directive
- Never use 1-line if statements
- Structure files: exported component, subcomponents, helpers, static content, types

## Error Handling & Validation

- Use custom AppError class when throwing errors
- When catching errors on the frontend use `const error = AppError.parse(error)` to get the error code
- Use early returns and guard clauses
- Use Zod for form validation and react-hook-form for forms
- Use error boundaries for unexpected errors

## UI & Styling

- Use Shadcn UI, Radix, and Tailwind CSS with mobile-first approach
- Use `<Form>` `<FormItem>` elements with fieldset having `:disabled` attribute when loading
- Use Lucide icons with longhand names (HomeIcon vs Home)

## TRPC Routes

- Each route in own file: `routers/teams/create-team.ts`
- Associated types file: `routers/teams/create-team.types.ts`
- Request/response schemas: `Z[RouteName]RequestSchema`, `Z[RouteName]ResponseSchema`
- Only use GET and POST methods in OpenAPI meta
- Deconstruct input argument on its own line
- Prefer route names such as get/getMany/find/create/update/delete
- "create" routes request schema should have the ID and data in the top level
- "update" routes request schema should have the ID in the top level and the data in a nested "data" object

## Translations & Remix

- Use `<Trans>string</Trans>` for JSX translations from `@lingui/react/macro`
- Use `t\`string\`` macro for TypeScript translations
- Use `(params: Route.Params)` and `(loaderData: Route.LoaderData)` for routes
- Directly return data from loaders, don't use `json()`
- Use `superLoaderJson` when sending complex data through loaders such as dates or prisma decimals

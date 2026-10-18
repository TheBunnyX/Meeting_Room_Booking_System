# Full-Stack Website Development — Next.js + Prisma on Vercel

## Mission

Act as a senior full-stack engineer responsible for delivering complete, maintainable,
secure, and production-ready web features.

Stack (single Next.js application in `apps/web`, deployed to Vercel):

- Application: Next.js App Router + React + TypeScript
- API: Next.js Route Handlers under `app/api/v1` (there is no separate backend service)
- Validation: Zod
- Database: PostgreSQL (Prisma Postgres on Vercel) through Prisma
- Migrations: Prisma Migrate (SQL migrations are committed)
- File storage: Vercel Blob
- Background work: Vercel Cron and traffic-triggered jobs claimed atomically in the database
- Auth: HTTP-only JWT cookie (`jose`) and Argon2id (`@node-rs/argon2`)
- Testing: Vitest (unit and API integration tests against a real PostgreSQL)
- Local development: `npm run db:local` (embedded PostgreSQL, no Docker)

Do not reintroduce a separate Python or other backend service unless the user explicitly
asks for that architecture. The previous FastAPI backend was removed on purpose.

---

# 1. Core Operating Principles

## 1.1 Inspect before editing

Before changing the repository:

1. Inspect the project tree and read `README.md`.
2. Inspect `apps/web/package.json`, `next.config.mjs`, `tsconfig.json`, `vercel.json`,
   `prisma/schema.prisma`, the migrations, and `.env.example`.
3. Detect and follow the existing conventions; reuse existing libraries and patterns.
4. Do not upgrade dependencies merely because a newer release exists.

When framework behavior is version-sensitive, consult the official documentation for the
version used by the project.

## 1.2 Make the smallest coherent change

Prefer a complete vertical slice over broad unrelated refactors. A feature is normally
incomplete until it includes, where applicable: UI, route handler, validation, schema change
and migration, authorization, loading/empty/error states, tests, and documentation or
environment updates.

## 1.3 Never hide uncertainty

If requirements are incomplete, make the safest reasonable assumption and record it briefly.
Do not invent database columns, external API behavior, secrets, product rules, permission
rules, or billing rules.

---

# 2. Architecture

```text
apps/web
├─ app/
│  ├─ api/v1/         # Route handlers: parse input, authorize, call a service, serialize
│  ├─ api/cron/       # Vercel Cron targets (protected by CRON_SECRET)
│  └─ ...             # Pages, layouts, shared components
├─ features/          # Feature UI (workspace, admin)
├─ lib/
│  ├─ server/         # Server-only code: config, db, security, validation, services, serializers
│  └─ ...             # Browser API client, types, helpers
├─ prisma/            # schema.prisma, migrations, seed
├─ tests/             # Unit tests and tests/server API integration tests
└─ vercel.json
```

Rules:

- Route handlers stay thin. Business rules live in `lib/server/services`.
- Wrap every handler with `route()` so errors leave in the stable
  `{ "error": { "code", "message", "field" } }` shape and nothing internal leaks.
- Validate every body and query string with a Zod schema in `lib/server/validation.ts`.
  Unknown properties are dropped, which prevents mass assignment.
- Serialize responses explicitly in `lib/server/serializers.ts`. Never return raw Prisma rows;
  never expose password hashes, tokens, or internal fields.
- Browser code must not import from `lib/server`.

---

# 3. Frontend Rules

- Use the App Router. Default to Server Components; add `"use client"` only for event handlers,
  state, effects, or browser APIs, and keep client boundaries small.
- Centralize API calls in `lib/api.ts`. Do not scatter raw `fetch()` calls.
- Every async flow handles loading, success, empty, validation error, server error,
  unauthorized/forbidden, retry where useful, and a disabled state while submitting.
- Forms validate on the client for UX and again on the server for security.
- Accessibility: semantic HTML, labelled controls, keyboard navigation, visible focus, and no
  status communicated by color alone.
- Build mobile-first and avoid fixed dimensions that cause horizontal overflow.
- Do not expose secrets through `NEXT_PUBLIC_*`.

---

# 4. API Rules

- Resources are nouns: `GET/POST /api/v1/rooms`, `PATCH/DELETE /api/v1/rooms/{id}`.
- Use `PATCH` for partial updates and appropriate status codes: 200, 201, 204, 400, 401, 403,
  404, 409, 422, 429, 500. Never return 200 for an error.
- Enforce authorization on the server for every protected operation, including object-level
  checks (ownership or membership). Hidden buttons and frontend guards are not authorization.
- Use `requireRoles`/`currentUser` from `lib/server/security.ts`.
- Cookie-authenticated state-changing requests from foreign origins are rejected by `route()`;
  keep that behavior intact.
- Cron endpoints require `CRON_SECRET` and fail closed when it is missing.

---

# 5. Database Rules

- Every model deliberately defines keys, nullability, unique constraints, indexes, relations,
  and timestamps where useful.
- Every schema change ships with a Prisma migration (`npm run db:migrate:dev -- --name ...`).
  Review the generated SQL, consider existing production rows, and never drop data silently.
- Constraints Prisma cannot model (for example the `bookings_no_overlap` exclusion constraint)
  are written by hand in the migration SQL and covered by a test.
- Use transactions (`db.$transaction`) for operations that must succeed or fail together,
  including the notifications and audit entries that describe the change.
- Serverless instances share no memory or disk: keep rate limits, locks, and job state in the
  database and files in Vercel Blob.
- Do not make a request wait for work that belongs in a background job.

---

# 6. Authentication and Authorization

- Hash passwords with Argon2id; never store plaintext; use secure random tokens.
- Session material lives in an `HttpOnly`, `SameSite=Lax`, `Secure` (production) cookie. Do not
  store long-lived secrets in `localStorage`.
- Revoke sessions by bumping `tokenVersion` (sign-out, password change, admin reset).
- Rate limit sensitive endpoints (sign-in, forgot password).

---

# 7. Environment Variables

- Maintain `apps/web/.env.example`; document every new variable there and in `README.md`.
- Read configuration through `lib/server/config.ts`; fail clearly when a required value is
  missing. Never commit real secrets.

---

# 8. Security Baseline

For every feature consider: authentication, authorization, object-level access, input
validation, SQL injection (use Prisma or tagged-template raw queries only), XSS, CSRF, SSRF,
file upload type/size/signature checks, secret leakage, log redaction, rate limiting,
brute force, mass assignment, ID enumeration, and dependency vulnerabilities.

Never log passwords, tokens, session cookies, or API secrets. Use allowlists for redirects.

---

# 9. Testing

- API behavior is tested in `tests/server` by calling the real route handlers against a real
  PostgreSQL (started automatically by the Vitest global setup). Cover at least: success,
  validation failure, not found, unauthenticated, unauthorized, and important business-rule
  conflicts.
- Pure utilities and important UI logic are covered by unit tests in `tests`.
- When fixing a bug, reproduce it with a failing test first when practical.
- Do not test implementation details that make refactors expensive.

---

# 10. Quality Gates

Before declaring work complete, run from `apps/web`:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

For schema changes, also apply the migration to a database (`npm run db:migrate`) and verify
the app against it. Never claim a check passed unless it was actually run; state exactly what
was skipped and why.

---

# 11. Vercel Deployment

- One Vercel project with Root Directory `apps/web`; `vercel.json` sets the build command
  (`prisma generate`, `prisma migrate deploy`, `next build`) and the cron schedules.
- Vercel limits to design around: request bodies up to 4.5 MB, no persistent disk, no
  long-running processes, and Hobby cron jobs at most once a day.
- Be careful that Preview deployments do not migrate the production database.

---

# 12. Git and Change Discipline

Keep changes easy to review. Do not reformat unrelated files, rename broad directory trees
without need, mix dependency upgrades with feature work, or rewrite working architecture for
stylistic preference.

---

# 13. Common Anti-Patterns to Avoid

- Putting business logic in route files or all code in one giant file
- Marking every component `"use client"`
- Returning raw database rows or trusting client-provided role/ownership fields
- Skipping migrations or using `prisma db push` against shared databases
- Keeping state in process memory or on local disk in serverless code
- Hardcoding production URLs or committing `.env` secrets
- Catching every exception and returning status 200
- Adding libraries the platform already covers, or abstractions before real duplication
- Claiming success without running the relevant checks

---

# 14. Definition of Done

- Requested behavior works and the frontend and API contracts agree
- Authorization is enforced server-side and inputs are validated
- A migration exists for schema changes
- Loading, empty, and error states are present; responsive and accessible
- Tests cover critical behavior; lint, typecheck, tests, and the production build pass
- New environment variables are documented; no secret is committed
- Important trade-offs are noted

---

# 15. Final Response Format

Respond concisely with **Implemented**, **Key changes**, **Validation** (commands actually run
and whether they passed), and **Notes** (migrations, environment variables, deployment steps,
or limitations, only when relevant). Do not paste large files unless asked.

---

# 16. Reference Documentation

- Next.js: https://nextjs.org/docs
- Prisma: https://www.prisma.io/docs
- Zod: https://zod.dev/
- Vercel: https://vercel.com/docs (Cron, Blob, Prisma Postgres)
- PostgreSQL: https://www.postgresql.org/docs/
- Vitest: https://vitest.dev/

The versions installed in the repository take precedence over generic examples.

# Workspace

A Next.js / Supabase engagement workspace. This is a set of working vertical slices, **not the completed product brief**. See PROGRESS.md for the exact remaining work.

## Start

1. Use Node 22 (`nvm use`), then `npm ci`.
2. Copy `.env.example` to `.env.local`; populate the Supabase project-root URL (without `/rest/v1`) and publishable key. Never commit credentials. The Supabase secret key stays server-only and is required for attachment extraction, AI execution, maintenance and the local seed.
3. Apply all SQL migrations in `supabase/migrations`, in filename order, to a dedicated development Supabase project. Recommended: add its session-pooler Postgres connection URI (Supabase Connect → Session pooler, port 5432; the default direct endpoint may require IPv6 unavailable in this environment) as `SUPABASE_DB_URL` in `.env.local`, then run `npm run db:check` followed by `npm run db:migrate`. The runner requires `psql`, uses TLS for remote connections (defaults to certificate verification), records checksums and applies pending migrations atomically. If the certificate is not trusted, download the public Supabase CA from the dashboard’s Database Settings → SSL Configuration and set `PGSSLROOTCERT` to its local path. For this workspace it is configured as `.certs/supabase-ca.crt` in `.env.local`; `.certs/` is gitignored. Keep `verify-full` enabled. It refuses an existing public application schema without migration history so it cannot silently adopt unrelated tables. Alternatively run the files through the SQL Editor; do not mix manual migrations with the runner without reconciling history. Never apply `tests/database-bootstrap.sql` to Supabase; it is only a vanilla-Postgres fixture.
4. Enable email confirmation in Auth. Set Site URL to `http://localhost:3000` and allow `http://localhost:3000/auth/callback`. Use local Mailpit when developing with local Supabase. To email engagement invitations, set `BREVO_API_KEY` and `BREVO_SENDER_EMAIL` in `.env.local`; the sender must be verified in Brevo. Set `NEXT_PUBLIC_APP_URL` to the address the invitee can actually open, then restart the app. Without these settings, the app still creates a link for manual sharing. A successful Brevo request means submitted, not delivered; check Brevo transactional email logs for delivery or rejection.
5. Enable Postgres Changes for `messages` (the migration adds the publication). Table RLS controls event delivery. Storage uses the private `engagement-files` bucket created by the migration.
6. Run `npm run dev`. Sign up, choose a starting Client or Freelancer / professional profile type, and confirm your email. The account menu switches the active context. Create a project in that context, invite the counterparty by email or share the generated link, then accept from a separate verified account/browser profile. Accepting an invitation selects its role in the account menu. Switching context changes the dashboard and role for future projects; existing project memberships retain their original roles and permissions.

Without Supabase configuration, the home and sign-in pages show an honest setup state. They do not fabricate accounts or projects. Provider configuration is described in docs/PROVIDERS.md. Sandbox payment/ledger/refund code is implemented; real seller onboarding, checkout and webhook validation remain pending setup. Live payments are disabled.

Development output uses `.next-dev`; production builds use `.next`, so running a build cannot overwrite the live development server's client chunks. Test configurations can still set their own `NEXT_DIST_DIR`.

## Hackathon admin credits

The `/admin` Users page also shows email verification status and a **Verify email** action for unconfirmed accounts. This confirms email status only, not identity. **View conversations** opens paginated shared discussions and the selected user's private conversations, separately labelled. Conversation views and verification attempts/completions are recorded in the service-only `admin_activity` table. Each page and action checks the verified admin allowlist.

Set `ADMIN_EMAILS` in `.env.local` to the verified email address of each authorised admin (comma-separated). Restart the app, sign in with that account, and open `/admin` → **Users**. Each engagement shows its shared balance and that user's private balance. Enter Workspace tokens, choose Add or Remove, and provide a reason. Ten tokens equal $1 of AI usage value; the first-project grant is 50 shared tokens. Adjustments are promotional, append-only in the credit ledger, and do not create a purchase or payment. Removing tokens can only consume available promotional units; reserved or purchased units are protected. Adding at least 50 tokens to a pending shared balance activates that hackathon engagement. The admin page and action both enforce the server-side allowlist; never expose `SUPABASE_SECRET_KEY` to the browser.

Workspace tokens are prepaid application usage units, not model input/output tokens or money held for professional payments. Real token checkout remains future work.

## Local repeatable demo

Use **local Supabase only**. Set `SEED_PASSWORD` (at least 12 characters) and `SUPABASE_SECRET_KEY`, then run:

```sh
node --env-file=.env.local scripts/seed-demo.mjs
```

This creates two local verified fixture accounts (`client@example.test`, `professional@example.test`), a labelled reporting-dashboard engagement, shared discussion, a client-private note, CSV/source event, approved milestone plan, prepared delivery and confirmed review meeting. All activity is explicitly demo-labelled and excluded from real public reputation. Rerunning leaves an existing demo unchanged. It does not send email, create payments or publish reviews. Use a fresh local database for a fully repeatable starter-grant demo. Hosted projects are deliberately rejected.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run test:db
npx playwright install chromium
npm run test:e2e
npm run build
```

Database tests require local Postgres 18 binaries (`PG_BIN` can override their location). The runner starts an isolated temporary Unix-socket database, tests grants/approvals/privacy/credits/concurrency, and removes it. It does not use your Supabase credentials. Browser checks use an isolated `.next-e2e` directory on port 3100 and explicitly clear provider settings, so they remain deterministic after `.env.local` is populated. They currently cover unconfigured desktop/mobile setup only; the authenticated hosted journey is tested separately as described below.

## Providers

See docs/PROVIDERS.md for exact setup requirements, docs/ARCHITECTURE.md for permissions/review/credit policies and docs/AI.md for the tool inventory and failure/recovery rules. No deployment, live payment, seller onboarding, public review or real outreach has been performed.

## Hosted authenticated integration test

Run only against a dedicated development Supabase project after migrations:

```sh
npm run test:integration
npm run test:admin
npm run test:concerns
npm run test:context
```

The main suite uses `.env.local` and port 3200 with `.next-integration`. It creates three disposable labelled fixture accounts (client, professional, outsider), verifies generated signup tokens without sending email, signs in through the UI, and tests grants, invitations, privacy, actual Realtime messages, sharing, uploads/downloads, threads/mentions, extracted-text privacy, context-switch draft clearing, credit views, disabled-provider handling dual-approved scope/revisions, milestone scheduling, delivery acceptance, meeting/ICS, profiles and double-blind demo feedback. `test:admin` uses separate disposable accounts and a temporary test-only admin allowlist to verify the Users page, access restriction, demo grant and project activation. `test:concerns` checks revocation, two-party concern resolution and an accepted payment request. `test:context` checks signup profile type, account-menu switching, role-filtered dashboard, future project roles, and preservation of old memberships. These tests execute no AI or provider payments. Real email delivery and the emailed PKCE callback remain untested.

The teardown removes fixture files, engagement data and accounts, including after a test failure. If the process is interrupted, `npm run test:integration:cleanup` retries cleanup for the non-secret run IDs recorded under gitignored `.integration-runs/`. Cleanup is restricted to matching account metadata and `[E2E]` engagements. Do not run fixture cleanup while another integration run is active.

## Explicit OpenAI provider smoke test

`npm run test:providers` uses the configured API key and makes two real, bounded Responses calls with synthetic fixture content only. It incurs provider cost and is separate from the deterministic checks. The first approved run passed; see docs/PROVIDERS.md for the exact payload scope, metering result and limits.

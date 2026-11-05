# Workspace progress

Updated 2026-11-04. **The full brief is not complete.** Human collaboration works independently of provider setup. OpenAI execution remains disabled; PayPal and Bryntum are not presented as functioning integrations.

## Completed source/workflows

- [x] One Next.js 16.4.5 / React 19.3 / TypeScript / Tailwind application, lockfile, Node 22 configuration, accessible Radix-based controls and environment placeholders.
- [x] Supabase SSR authentication/confirmation callback, verified-user checks, per-engagement client/professional roles and dashboard role filters. One account can use both roles across engagements.
- [x] Secure email-bound, expiring, single-use invitations; replacement revokes earlier tokens. Closed engagements reject invitation acceptance. No invitation email is sent.
- [x] Once-only atomic $5 shared starter grant on first verified creation; three isolated balances/configurations. Later projects remain private pending-funding drafts.
- [x] Shared/private persisted discussion, threads, mentions, unread markers, owner-only notifications, actual authenticated Realtime and explicit selected-content preview/confirmation sharing.
- [x] Private Storage, authorised 60-second downloads, basic MIME/signature/UTF-8 checks, safe upload names, confirmation lifecycle, source Discussion events, scoped file filters and bounded text previews. Shared views exclude private metadata/content.
- [x] TXT/CSV extraction with immutable SHA-256 versions and partial/error status. PDF/image analysis is visibly unsupported.
- [x] Immutable structured scopes, per-party approval of the same version, historical approval records, change explanation/comparison and stale/race protection. Messages remain append-only evidence; edit/redaction tools are not implemented.
- [x] Promotional/purchased credit lots, immutable pricing/top-up policy, reservations, cached-token metering, 2× settlement, releases, corrections, refund holds and maintenance recovery. Service-only verified purchase settlement atomically funds pending projects. These are accounting primitives, not working PayPal checkout.
- [x] Scoped agent histories/retrieval, citation/version validation, bounded OpenAI tool calling/streamed structured adapter, summary refresh and explicit partial-result keep/discard UI. Internal/unusable failures are platform-funded. No real model request has been made.
- [x] Credit available/reserved/spent and source/usage/ledger views, low/exhausted handling. Human functions remain accessible with zero AI balance.
- [x] Milestone tasks/dependencies materialised from immutable scope plans; accepted/proposed schedules, owner progress, numbered delivery/shared-file submissions and client acceptance/change requests. Original version references survive revisions.
- [x] Meeting proposals/responses/revisions, tentative versus confirmed times, UTC/IANA timezone handling, DST occurrence choice, private ICS export, internal-clash warnings, notes and aggregate personal calendar.
- [x] Opt-in public profiles/company identity, mutual completion and explicit cancellation, accepted-agreement-qualified reviews, SQL-enforced double-blind/deadline privacy, frozen feedback/replies, reports/service-only moderation and client-approved portfolio publication.
- [x] Completion badge with published activity criteria. Demo activity is excluded from real public reviews, completion facts, portfolios and badges; no quality/identity/fraud-free claims.
- [x] Twelve migrations applied to hosted development Supabase with checksums and verified TLS; zero pending. Local-only repeatable seed and sub-three-minute demo script updated.

## Actual validation

- [x] Typecheck and ESLint passed.
- [x] 40 unit tests passed, including exact prices/cached usage, bounded provider mocks, evidence/privacy validation, milestone dependencies, DST gaps/repeated times and safe ICS folding/escaping.
- [x] Isolated Postgres 18 suite passed all twelve migrations and permission/accounting tests: cross-party/cross-engagement isolation, storage/retrieval, grant/purchase replay, concurrent reservations, source conservation, failure recovery/corrections/refunds, stale/concurrent scope submission and dual approval, delivery roles/history, meeting transitions, cancelled-review threshold, double-blind/deadline publication, moderation and demo exclusion.
- [x] Two desktop/mobile setup-state Playwright checks passed.
- [x] Full hosted authenticated journey plus focused completion/review regression passed (2 tests, approximately 5.2 minutes). It covers generated confirmation tokens, UI sign-in, grant/invitation, actual private Realtime isolation, sharing, file upload/extraction/search/download/source links, scope/change/milestone approvals, delivery acceptance, meeting/ICS, profiles, double-blind demo feedback and pending second-project funding.
- [x] Additional hosted review/reply regression passed (approximately 1.1 minutes), including persisted right of reply and mobile overflow check. Stable saved-reply screens were inspected at desktop and mobile widths.
- [x] Production build passed after final application changes. Demo seed syntax check passed.
- [x] Discussion/calendar/reputation inspected at desktop/mobile widths; milestone and public-profile screens inspected at desktop width. Mobile calendar spacing improved. Public demo profile correctly showed zero real reviews/completions.
- [ ] Local seed execution: local Supabase is not running here. Its fixture functions are covered by local SQL/hosted workflow tests, but the script itself has not been executed.
- [ ] Real signup email delivery/emailed PKCE callback: no outreach test authorised or performed; fixtures verify generated signup tokens without sending email.
- [ ] Real OpenAI calls, PayPal sandbox orders/captures/webhook authenticity/reconciliation, seller/platform eligibility and licensed Bryntum rendering: untested and incomplete as detailed below.

## Blocked integration work / exact next input

1. **OpenAI:** add `OPENAI_API_KEY`; set `OPENAI_MODEL=gpt-5-mini-2025-08-07`. Keep `AI_ENABLED=false` until a controlled provider check is ready. Adapter/accounting are implemented, but real model availability, output quality, latency and receipts must be verified. Private agent usage also needs real credit purchasing.
2. **PayPal sandbox:** populate the separate `PAYPAL_PARTNER_*` and `PAYPAL_CREDITS_*` settings in `.env.local`, with eligible sandbox seller/buyer accounts. Confirm partner approval, seller-country/onboarding and partner-fee capability plus platform-credit merchant configuration. Provider onboarding/checkout/capture/webhook/refund code is still required; the database ledger and 1% arithmetic do not constitute an integration. No escrow/custody or automatic agent payment exists.
3. **Bryntum:** provide licensed registry access/entitlements for both products. Public trial metadata reports 7.3.8, but no commercial/trial distribution was installed. Verify matching thin/shared-core libraries and React wrappers before adding the client-only renderers. Useful basic schedule/meeting views are implemented and explicitly identify the missing Bryntum views. Do not claim these lists qualify as Bryntum usage.

See [provider instructions](docs/PROVIDERS.md), [AI tools/billing/access](docs/AI.md), [architecture and policies](docs/ARCHITECTURE.md) and [demo](docs/DEMO.md). Credentials stay local/server-only; never paste them into chat.

## Remaining supporting work

- PDF/image analysis with verified pricing, real upload transfer progress, malware-scanning decision and abandoned-upload recovery. Current validation is basic signature checking, not malware scanning.
- Notification pagination/instant approval refresh, complete audit UI, explicit invitation-revocation management, message edit/redaction policy tools and further accessibility polish. Message history pagination and direct evidence loading are implemented.
- Concerns/mediation case records, archival, repeat-engagement statistics and staff moderation console. Current reports are persisted; only trusted staff service access can moderate with recorded reasons.
- Deploy a recurring authenticated maintenance call for expired AI work; no scheduler or deployment has been configured. No purchased-credit expiration is invented.
- Extend the final provider-backed video only after real sandbox/AI/Bryntum checks; no simulated result should replace verification.

The final SQL-only guard also rejects direct scope RPCs without a change explanation after acceptance; it passed the twelve-migration isolated suite and was applied after the hosted journey.

No production access was changed, app deployed, live money charged, outreach sent or real public review published. Hosted test accounts/data are labelled disposable fixtures and cleaned up; interrupted runs can be cleaned using `npm run test:integration:cleanup` with their recorded run metadata.

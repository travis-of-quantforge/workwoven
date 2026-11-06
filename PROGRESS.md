# Workspace progress

Updated 2026-11-06. **The full brief is not complete.** Human collaboration works independently of provider setup. The configured OpenAI model passed a bounded synthetic provider test. Licensed Bryntum evaluation views render persisted data. PayPal remains unimplemented. The hackathon uses audited admin-issued promotional AI credits; real credit purchases are deferred. Future monetization is prepaid AI credits used at 2× provider cost, with no Workspace commission on professional payments.

## Completed source/workflows

- [x] One Next.js 16.4.5 / React 19.3 / TypeScript / Tailwind application, lockfile, Node 22 configuration, accessible Radix-based controls and environment placeholders.
- [x] Supabase SSR authentication/confirmation callback, verified-user checks, signup profile type, account-menu context switching and role-filtered dashboard. New engagements use the saved active context; existing per-engagement memberships remain authoritative for access and approvals. One account can use both roles across engagements.
- [x] Secure email-bound, expiring, single-use invitations; replacement revokes earlier tokens. Closed engagements reject invitation acceptance. No invitation email is sent.
- [x] Pending invitations are visible to the creator and can be explicitly revoked. Revoked tokens cannot be accepted; a fresh invitation can be issued.
- [x] Once-only atomic $5 shared starter grant on first verified creation; three isolated balances/configurations. Later projects remain private pending-funding drafts.
- [x] Shared/private persisted discussion, threads, mentions, unread markers, owner-only notifications, actual authenticated Realtime and explicit selected-content preview/confirmation sharing.
- [x] Private Storage, authorised 60-second downloads, basic MIME/signature/UTF-8 checks, safe upload names, confirmation lifecycle, source Discussion events, scoped file filters and bounded text previews. Shared views exclude private metadata/content.
- [x] TXT/CSV extraction with immutable SHA-256 versions and partial/error status. PDF/image analysis is visibly unsupported.
- [x] Immutable structured scopes, per-party approval of the same version, historical approval records, change explanation/comparison and stale/race protection. Messages remain append-only evidence; edit/redaction tools are not implemented.
- [x] Promotional/purchased credit lots, immutable pricing/top-up policy, reservations, cached-token metering, 2× settlement, releases, corrections, refund holds and maintenance recovery. Service-only verified purchase settlement atomically funds pending projects. These are accounting primitives, not working PayPal checkout.
- [x] Scoped agent histories/retrieval, citation/version validation, bounded OpenAI tool calling/streamed structured adapter, summary refresh and explicit partial-result keep/discard UI. Internal/unusable failures are platform-funded. A separately approved synthetic two-call GPT-6 Luna smoke test passed; real workspace content has not been sent.
- [x] Credit available/reserved/spent and source/usage/ledger views, low/exhausted handling. Human functions remain accessible with zero AI balance.
- [x] `/admin` Users view with verified-email server allowlist and service-only, transactional promotional credit additions/removals. Each adjustment records actor, reason, ledger entries and before/after amount. Admin funding can activate a pending demo engagement; no purchase is fabricated.
- [x] Milestone tasks/dependencies materialised from immutable scope plans; accepted/proposed schedules, owner progress, numbered delivery/shared-file submissions and client acceptance/change requests. Original version references survive revisions.
- [x] Shared concern cases with each party's position, auditable updates, notifications and mutual resolution acknowledgement. Opening or resolving a concern does not alter the engagement, agreement, or payments. The source text also appears in shared Discussion for evidence-grounded project-agent advice.
- [x] Professional payment requests tied to the exact accepted scope and payable milestone or unallocated agreement balance. Amount, payee and terms come from accepted records; old requests become superseded when a revision is accepted. Requests do not charge or confirm payment.
- [x] Meeting proposals/responses/revisions, tentative versus confirmed times, UTC/IANA timezone handling, DST occurrence choice, private ICS export, internal-clash warnings, notes and aggregate personal calendar.
- [x] Opt-in public profiles/company identity, mutual completion and explicit cancellation, accepted-agreement-qualified reviews, SQL-enforced double-blind/deadline privacy, frozen feedback/replies, reports/service-only moderation and client-approved portfolio publication.
- [x] Completion badge with published activity criteria. Demo activity is excluded from real public reviews, completion facts, portfolios and badges; no quality/identity/fraud-free claims.
- [x] Seventeen migrations applied to hosted development Supabase with checksums and verified TLS; zero pending. Local-only repeatable seed and sub-three-minute demo script updated.

## Actual validation

- [x] Typecheck and ESLint passed.
- [x] 42 unit tests passed, including no-commission PayPal order/capture guards, exact prices/cached usage, bounded provider mocks, evidence/privacy validation, milestone dependencies, DST gaps/repeated times and safe ICS folding/escaping.
- [x] Isolated Postgres 18 suite passed all seventeen migrations and permission/accounting tests: cross-party/cross-engagement isolation, storage/retrieval, grant/purchase replay, concurrent reservations, source conservation, admin adjustment permissions/replay/overdraft/activation, failure recovery/corrections/refunds, stale/concurrent scope submission and dual approval, delivery roles/history, meeting transitions, cancelled-review threshold, double-blind/deadline publication, moderation and demo exclusion. New cases cover invitation revocation, concern privacy/mutual resolution, version-bound payment request amounts/roles/replay/supersession, saved-role enforcement and rejected browser-supplied role overrides.
- [x] Two desktop/mobile setup-state Playwright checks passed.
- [x] Full hosted authenticated journey plus Bryntum and focused completion/review regressions passed (3 tests, 6.2 minutes). It covers generated confirmation tokens, UI sign-in, grant/invitation, actual private Realtime isolation, sharing, file upload/extraction/search/download/source links, scope/change/milestone approvals, delivery acceptance, meeting/ICS, profiles, double-blind demo feedback and pending second-project funding.
- [x] Additional hosted review/reply regression passed (approximately 1.1 minutes), including persisted right of reply and mobile overflow check. Stable saved-reply screens were inspected at desktop and mobile widths.
- [x] Focused hosted admin browser test passed with disposable verified accounts: non-admin access denied, admin Users page, $5 promotional grant, pending-project activation, audit record, mobile overflow and cleanup.
- [x] Focused hosted two-account browser journey passed: revoked and fresh invitations, concern opening/replies/mutual resolution, shared Discussion evidence, mobile concern layout, dual scope approval, and a non-charging professional payment request visible to the client. Disposable fixtures were cleaned up.
- [x] Focused hosted account-context browser test passed: signup profile type, account-menu switches, dashboard filtering, creation under each active role, unchanged prior membership, once-only starter grant and mobile overflow. Disposable fixture was cleaned up.
- [x] Workspace tab loads now fetch only tab-relevant records and run independent reads concurrently. Authenticated account-context, Bryntum, concern and review browser checks passed; the full engagement journey passed on a focused rerun after correcting a test assertion for the void role-switch RPC. Each tab still uses authenticated server rendering for current permissions and data. Exact latency was not benchmarked.
- [x] Production build passed after final application changes. No OpenAI or Supabase secret key was found in browser assets. Demo seed syntax check passed.
- [x] Discussion/calendar/reputation inspected at desktop/mobile widths; real Bryntum Gantt/Calendar screens inspected at desktop/mobile widths; public-profile screen inspected at desktop width. Mobile calendar spacing improved. Public demo profile correctly showed zero real reviews/completions.
- [ ] Local seed execution: local Supabase is not running here. Its fixture functions are covered by local SQL/hosted workflow tests, but the script itself has not been executed.
- [ ] Real signup email delivery/emailed PKCE callback: no outreach test authorised or performed; fixtures verify generated signup tokens without sending email.
- [x] Approved two-call GPT-6 Luna synthetic provider check: two receipts, accepted-version evidence, privacy guard, exact 2× pricing and replay without another call. Provider cost $0.0002166, customer charge $0.0004332. This is a smoke test, not general agent-quality validation.
- [x] Bryntum 8 Gantt and Calendar evaluation renderers mounted against hosted fixture records; targeted desktop/mobile test passed for read-only dates, dependencies, proposed/accepted state, safe titles and licence acceptance.
- [ ] PayPal sandbox orders/captures/webhook authenticity/reconciliation and seller/platform eligibility remain untested and unimplemented.

## Blocked integration work / exact next input

1. **Admin setup:** add the intended verified administrator email to server-only `ADMIN_EMAILS` in `.env.local` and restart. The route deliberately denies access until configured. Migration 14 is already applied to the hosted development Supabase.
2. **OpenAI:** API key and selected GPT-6 Luna model are present; synthetic Responses and accounting test passed after explicit approval. Local ignored `.env.local` now has `AI_ENABLED=true`; explicit invocation and bounded reservation still gate each request. Private agents need separately allocated demo credits, and actual user-content advice needs ordinary human review.
3. **PayPal sandbox:** real credit purchasing is postponed until after the hackathon. The optional `npm run paypal:check` OAuth diagnostic passed with the configured sandbox Partner pair; no order or payment was made. Workspace charges no commission. Versioned professional payment requests now persist, but they cannot be paid in-app. The pure direct-seller order/capture guard has no platform-fee instruction and checkout remains disabled. Seller authorization, provider orders/captures, verified webhooks, reconciliation and refunds are still unimplemented. No escrow/custody or automatic agent payment exists.
4. **Bryntum:** user supplied a 45-day Enterprise trial key. Exact v8.0.0 product/React packages and browser runtime registration are implemented. Real read-only Gantt/Calendar views passed the targeted hosted browser test. Trial access is evaluation only; a production licence and permitted deployment setup are still needed.


See [provider instructions](docs/PROVIDERS.md), [AI tools/billing/access](docs/AI.md), [architecture and policies](docs/ARCHITECTURE.md) and [demo](docs/DEMO.md). Credentials stay local/server-only; never paste them into chat.

## Remaining supporting work

- PDF/image analysis with verified pricing, real upload transfer progress, malware-scanning decision and abandoned-upload recovery. Current validation is basic signature checking, not malware scanning.
- Notification pagination/instant approval refresh, complete audit UI, message edit/redaction policy tools and further accessibility polish. Message history pagination and direct evidence loading are implemented.
- Archival, repeat-engagement statistics and staff moderation console. Concern cases are available, but there is no binding settlement mechanism. Current reports are persisted; only trusted staff service access can moderate with recorded reasons.
- Deploy a recurring authenticated maintenance call for expired AI work; no scheduler or deployment has been configured. No purchased-credit expiration is invented.
- Extend the final provider-backed video after real PayPal sandbox checks; no simulated result should replace verification.

The SQL-only guard rejects direct scope RPCs without a change explanation after acceptance; it remains covered by the seventeen-migration isolated suite.

No production access was changed, app deployed, live money charged, outreach sent or real public review published. Hosted test accounts/data are labelled disposable fixtures and cleaned up; interrupted runs can be cleaned using `npm run test:integration:cleanup` with their recorded run metadata.

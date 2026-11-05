# Provider setup and verification gates

## Supabase

Populate URL and publishable key; apply migrations; enable email confirmation and configure PKCE callback URLs. Keep the secret/service-role key server-only. The app uses authenticated clients and RLS, including for signed downloads. The disposable two-account hosted journey now verifies sign-in, generated confirmation tokens, Storage and Realtime isolation. Email delivery and the emailed callback are still untested. Local Postgres tests stub Auth/Storage schemas and do not validate Supabase services themselves.

## OpenAI

The server-side Responses adapter, bounded evidence tool, strict structured output, streamed draft preview, actual token metering and credit settlement are implemented. No real provider request has been tested: `OPENAI_API_KEY` and `OPENAI_MODEL` are absent and `AI_ENABLED=false`.

For the first provider check, set `OPENAI_API_KEY` locally and `OPENAI_MODEL=gpt-5-mini-2025-08-07`. Keep `AI_ENABLED=false` until ready to test, then explicitly set it to `true` and restart the app. The seeded pricing version supports only that pinned model at standard (`default`) service tier: input $0.25 / million tokens, cached input $0.025 / million, output $2 / million. These rates were checked against official documentation on 2026-11-04; recheck before enabling. Other models need a new verified immutable `ai_pricing` version. Do not edit past rate snapshots.

Each operation uses at most two requests (one forced retrieval call, one structured answer), 512 + 4096 output tokens including reasoning, low reasoning effort, no SDK retries, 45 seconds per request, 64 KB request cap and a server-computed maximum reservation. The user confirms that maximum; only actual verified usage × 2 is charged. There are no paid built-in web/file-search tools. TXT/CSV decoding is local and free. PDF/image extraction is visibly unsupported. See AI.md for permissions, failure and recovery details.

`MAINTENANCE_SECRET` protects `POST /api/maintenance`. Supply a random secret of at least 32 characters; schedule a server-side call every five minutes using `Authorization: Bearer <secret>` when deploying. No scheduler/deployment is configured here. Each call releases up to 100 expired reservations; call repeatedly if a backlog remains. Running operations expire after the configured database reservation period, and partial offers after 24 hours. Uncertain provider expenses are recorded for reconciliation and never automatically charged to users.

Official references: [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [function calling](https://developers.openai.com/api/docs/guides/function-calling), [model](https://developers.openai.com/api/docs/models/gpt-5-mini), [pricing](https://developers.openai.com/api/docs/pricing).

## PayPal

Sandbox is the intended environment. Populate separate PARTNER and CREDITS settings. Verify whether the provided merchant arrangement can act as partner commission recipient and platform credit seller; do not assume one account suffices. Seller merchant IDs belong in persisted onboarding records, not browser-supplied checkout fields.

Implementation remains pending: before-payment seller onboarding, eligibility/consent verification, Orders create/capture, platform fee configuration, independent credit checkout, authenticity-verified webhooks, durable reconciliation and explicit authorised refunds. No checkout button is falsely presented as working. The accepted agreement stays useful while these integrations are developed.

Official starting points:
- https://developer.paypal.com/platforms/get-started
- https://developer.paypal.com/platforms/checkout/immediate-capture
- https://developer.paypal.com/platforms/checkout/issue-refund

Capture must reconcile currency, amount, payee and reference; browser success is not confirmation. Verify platform fee refunds explicitly. Live partner approval, seller-country eligibility and permissions are unverified.

## Bryntum

Populate registry authentication locally; never commit `.npmrc` or commercial distribution files. Gantt and Calendar packages/adapters are not installed yet. Consult the licensed registry and current guides to confirm exact product/wrapper versions, peer dependencies and styles before installing. Use client-only dynamic loading with SSR disabled, backed by persisted schedules/events. Basic list placeholders do not count as Bryntum integration.

- https://bryntum.com/products/gantt/docs/guide/Gantt/quick-start/nextjs
- https://bryntum.com/products/calendar/docs/guide/Calendar/integration/react/guide

Commercial access was reported available but has not been populated or verified in this environment.

## Exact remaining setup

1. **OpenAI:** add the API key and pinned model above to `.env.local`; leave `AI_ENABLED=false` until the first controlled provider check. The key/model are currently missing. A real call and provider receipt comparison are still needed.
2. **PayPal:** add all `PAYPAL_PARTNER_*` and `PAYPAL_CREDITS_*` placeholders, keep `PAYPAL_ENVIRONMENT=sandbox`, and provide an eligible sandbox professional seller plus buyer account. The platform-credit seller merchant and partner commission merchant configuration must be confirmed separately with PayPal. Add separate webhook registrations for each app/merchant flow once the webhook handlers are implemented and an authorised reachable HTTPS development callback is available. No public tunnel, app or webhook has been created here. Current official immediate-capture guidance requires approved partner access and onboarded sellers; credentials alone do not satisfy that capability gate. Checkout/onboarding/webhook implementation remains required.
3. **Bryntum:** configure private registry access using your Customer Zone credentials (`npm login --registry=https://npm.bryntum.com`, with the documented email username format) or an issued registry token via ignored npm configuration. A token in `.env.local` is not automatically npm authentication. Do not paste credentials in chat. Confirm entitlements for both Gantt and Calendar. Public metadata currently reports 7.3.8, but the licensed versions and dependencies must be checked after authentication. Pin matching wrapper/library versions and retain the lockfile.

The current vendor documentation exposes [LLM-readable Next.js setup](https://bryntum.com/products/gantt/docs-llm/guide/Gantt/quick-start/nextjs.md) and [React multiple-product setup](https://bryntum.com/products/gantt/docs-llm/guide/Gantt/integration/react/multiple-products.md). Combining Gantt and Calendar requires thin packages with shared core/grid/scheduler/engine dependencies, rather than two full bundles. Resolve that dependency set from the authenticated registry, then load the React adapters client-only (`dynamic(..., {ssr:false})` in a client component), with the matching structural/theme CSS. Route edits into proposal RPCs; accepted records must stay read-only. The existing milestone/calendar view components are the rendering boundaries; their relational data and approval actions are independent of Bryntum.

Public trials are available, but no trial distribution was downloaded or installed because commercial access was reported available. No production eligibility, licensing compatibility or real provider behaviour is inferred from metadata/documentation alone.

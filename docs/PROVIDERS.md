# Provider setup and verification gates

## Supabase

Populate URL and publishable key; apply migrations; enable email confirmation and configure PKCE callback URLs. Keep the secret/service-role key server-only. The app uses authenticated clients and RLS, including for signed downloads. The disposable two-account hosted journey now verifies sign-in, generated confirmation tokens, Storage and Realtime isolation. Email delivery and the emailed callback are still untested. Local Postgres tests stub Auth/Storage schemas and do not validate Supabase services themselves.

## OpenAI

Configured model: `gpt-6-luna`, preserved from the user's selection. Official model/pricing/cache documentation was checked on 2026-11-05. Versioned Standard short-context rates are $0.10 / million input, $0.01 / million cache-read, and $0.50 / million output tokens. This integration deliberately uses `prompt_cache_options: {mode:"explicit"}` with no breakpoints for Luna, so it creates no cache writes or reads. Unexpected/unconfirmed cache usage is rejected rather than silently mispriced. The 64 KB request limit keeps requests below long-context pricing thresholds. No regional-processing premium or optional paid tools are requested.

The separate pinned `gpt-5-mini-2025-08-07` pricing version remains available ($0.25/$0.025/$2 per million input/cached/output tokens). Select models through `OPENAI_MODEL` and add a new immutable `ai_pricing` version for different models/rates; do not overwrite historical snapshots. Recheck official rates before production launch.

After explicit user approval, `npm run test:providers` made the first real bounded Responses requests using only synthetic dashboard requirements and generated evidence references. It verified citations, two provider receipts, exact 2× settlement, released reservations, replay without a new model call, forbidden private context and zero-funded private-agent blocking. Actual provider cost was $0.0002166; customer usage charge was $0.0004332 against a maximum reservation of $0.0318464. No real client conversation/file/private note was sent. The fixture records were cleaned up. Re-running this command makes real API requests and incurs provider costs; it is separate from deterministic tests.

The adapter makes at most two calls, caps output at 512 + 4096 tokens including reasoning, uses low reasoning effort, disables SDK retries, applies a 45-second timeout per call and requires the human's maximum-budget confirmation. Only actual verified usage × 2 is charged. TXT/CSV decoding is local/free; PDF/image analysis remains unsupported. See AI.md for permissions, failure and recovery rules.

`MAINTENANCE_SECRET` protects `POST /api/maintenance`. Schedule a deployment-side call every five minutes using `Authorization: Bearer <secret>`; no scheduler/deployment is installed here. Each call releases up to 100 expired reservations; repeat if a backlog remains. Running reservations expire after 15 minutes and partial offers after 24 hours. Uncertain provider expenses are marked for reconciliation and never estimated into a customer charge.

Official references: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [pricing](https://developers.openai.com/api/docs/pricing), [cache write pricing and explicit-only disabling](https://developers.openai.com/api/docs/guides/prompt-caching), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## PayPal

Sandbox is the intended environment. Populate separate PARTNER and CREDITS settings. Verify whether the provided merchant arrangement can act as partner commission recipient and platform credit seller; do not assume one account suffices. Seller merchant IDs belong in persisted onboarding records, not browser-supplied checkout fields.

Implementation remains pending: before-payment seller onboarding, eligibility/consent verification, Orders create/capture, platform fee configuration, independent credit checkout, authenticity-verified webhooks, durable reconciliation and explicit authorised refunds. No checkout button is falsely presented as working. The accepted agreement stays useful while these integrations are developed.

Official starting points:
- https://developer.paypal.com/platforms/get-started
- https://developer.paypal.com/platforms/checkout/immediate-capture
- https://developer.paypal.com/platforms/checkout/issue-refund

Capture must reconcile currency, amount, payee and reference; browser success is not confirmation. Verify platform fee refunds explicitly. Live partner approval, seller-country eligibility and permissions are unverified.

## Bryntum

The supplied key uses **Bryntum 8 Enterprise**, available from public npm. Matching Gantt/Calendar product and React wrapper packages are installed at exact `8.0.0` versions, sharing Enterprise core/grid/scheduler dependencies. Node modules and commercial distribution files remain ignored; only package references/lockfile and application adapter source are in the project.

`NEXT_PUBLIC_BRYNTUM_LICENSE_KEY` is read from `.env.local` and registered on `(globalThis.bryntum ??= {}).licenseKey` before the client-only dynamic imports create a component. It is a browser runtime licence, not an npm token. Actual keys stay out of committed source; the OpenAI API key must never use a `NEXT_PUBLIC_` variable.

Gantt renders persisted accepted/proposed scope plans, dependencies and owner progress. Tasks are manually scheduled for faithful date display; the widget is read-only. Date/dependency edits go through the existing proposal form and dual approval, preserving accepted records. Calendar renders current confirmed and pending meeting versions with different labels/colours and links to the meeting card. Drag/edit actions are disabled; proposals and responses remain the authoritative workflow. Trial badges remain visible; this is evaluation access, not a production licensing claim.

The targeted hosted browser test verifies both products mount without a licence mask, correct accepted task dates/dependencies and read-only state, separately proposed schedules, tentative/confirmed meeting events, escaped malicious names, cross-tab bundle coexistence and mobile overflow. Desktop/mobile screenshots were inspected; the compact mobile timeline shows task bars and dependency lines. The full hosted regression passed all three cases in 6.2 minutes.

Official references: [Bryntum 8 tiers/trials/public npm](https://bryntum.com/tiers-faq/), [React quick start and early key registration](https://www.bryntum.com/products/scheduler-next/docs/guide/Scheduler/quick-start/react). The old v7 private-registry/thin-package setup does not apply to the supplied v8 trial. Do not remove the watermark or redistribute distribution files beyond the vendor's licence terms.

## Remaining setup

- **PayPal:** populate all separate `PAYPAL_PARTNER_*` and `PAYPAL_CREDITS_*` settings, keep `PAYPAL_ENVIRONMENT=sandbox`, and provide eligible sandbox seller/buyer accounts. Confirm partner commission capability and the platform's separate AI-credit merchant configuration. Webhook handlers, onboarding, orders/capture and explicit refund integration still need implementation and provider verification. No public tunnel, webhook registration, live charge or deployment has been created.
- **OpenAI:** key/model are present and the approved synthetic provider test passed. Local `AI_ENABLED=true` is recorded in PROGRESS.md; individual requests still require explicit invocation/budget confirmation. Private agents need separately purchased credits; no free private allowance is added.
- **Bryntum:** runtime key is present and evaluation rendering is verified. Track the vendor's trial period and obtain the appropriate production licence before deployment.

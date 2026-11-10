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

## PayPal sandbox payments

The application now has a direct-to-seller sandbox implementation: seller onboarding and verification, persistent server-created Orders, explicit client capture, provider-backed status refresh, signature-verified webhooks, partial/full refunds against the original capture, a shared append-only ledger and CSV export. This is implementation status, not a completed provider-backed acceptance test. OAuth authentication passed; real seller onboarding, buyer approval/capture, delivered webhook and refund verification remain pending configuration and interactive sandbox accounts. Live payment endpoints and live credentials are deliberately unsupported.

Configure these server-only settings in `.env.local`:

- `PAYPAL_ENVIRONMENT=sandbox`.
- `SANDBOX_PAYPAL_PARTNER_CLIENT_ID` and `SANDBOX_PAYPAL_PARTNER_CLIENT_SECRET`: the sandbox Partner app. Both are already configured and OAuth returns HTTP 200 with Partner Referrals scope.
- `SANDBOX_PAYPAL_PARTNER_MERCHANT_ID`: the 13-character Account ID of the sandbox business account that owns that Partner app. Find the corresponding business account under Developer Dashboard → Testing Tools → Sandbox Accounts → View/Edit account → Account ID. This differs from the client ID and from each professional's eventual seller ID.
- `SANDBOX_PAYPAL_PARTNER_ATTRIBUTION_ID`: the app's BN code, under App Settings → Reports (last line). This attributes the integration; the application does not request a platform commission.
- `NEXT_PUBLIC_APP_URL`: the canonical application URL used for browser return links. Use the same host when signing in, so the return retains the authenticated session.
- `SANDBOX_PAYPAL_PARTNER_WEBHOOK_ID`: register a sandbox webhook on that app for `https://YOUR-HTTPS-HOST/api/paypal/webhook`, then copy its ID. Subscribe to `CHECKOUT.ORDER.APPROVED`, `CHECKOUT.ORDER.COMPLETED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED` and `PAYMENT.CAPTURE.REFUNDED`. Localhost cannot receive PayPal webhooks; a public HTTPS development URL is needed. No tunnel, deployment or webhook registration has been created automatically.

After changing settings, restart development. `npm run paypal:check` checks sandbox authentication and reports setting presence only; it does not create a charge and is not seller/production eligibility verification.

In Payments as the professional, click **Connect PayPal sandbox**, sign into a separate sandbox seller account, and grant PAYMENT/REFUND permissions. Return and click **Refresh connection**. The server discovers the seller through the stored tracking ID and checks the app-specific OAuth grants, email confirmation and payments receivability; callback query flags never verify an account. A client can then pay an accepted milestone or create/pay a bonus. A professional can request hourly or other ad hoc payments. The client approves on PayPal and returns to **Complete sandbox payment**; capture is an explicit authenticated POST, not a GET callback. Use a separate sandbox buyer account. A professional can then issue a partial/full refund from the original completed receipt. Never use real cards or live accounts for this check.

Server-side Orders/captures and webhook reconciliation verify the exact order, request/reference ID, currency, amount, seller and capture. Browser return flags cannot mark a payment paid. Replayed events and repeated actions do not add a second paid/refunded ledger entry. Only completed captures/refunds affect totals. Delayed events cannot undo a completed receipt. Refunds made directly in PayPal are reconciled from independently retrieved refund details linked to the capture. No webhook certificate URL is fetched by the application; PayPal verifies signatures through its fixed sandbox API.

Retries reuse persisted operation IDs. A lost/timeout response stays pending rather than being treated as a failed charge. Creating a second checkout for the same outstanding request is prevented, and concurrent refunds reserve the remaining captured amount. Unknown order/refund creations older than three hours require reconciliation rather than a new provider call; this conservative limit is below PayPal's documented default six-hour idempotency retention. Uncertain capture processing temporarily prevents accepting a price revision of that milestone until reconciled. An accepted revision cancels obsolete uncaptured local checkouts so they cannot block the new balance or be captured later; delayed pending events cannot revive them. The outstanding amount is rechecked again immediately before an authorized capture. Human messaging/files remain usable. If webhook delivery is not configured, explicit **Refresh payment status** can verify known orders/refunds, but background convergence is not established. No recurring payment-reconciliation job has been deployed.

All amounts are USD integer cents. The client pays the accepted/requested gross amount directly to the verified professional seller; Workspace takes no commission and adds no `platform_fees` instruction. PayPal processing fees are separate and not assigned an invented universal rate. Ledger net paid means gross captures less completed refunds, before provider fees; it is not a bank-settlement report. A refund reverses the original capture, not a new payment to another recipient. The full application refund reason is retained; PayPal receives at most 255 characters. Refunding does not edit delivery acceptance, scope or create a binding settlement.

The separate `PAYPAL_CREDITS_*` merchant setup remains unused: real AI-credit purchases are still deferred, and `/admin` promotional allocations remain the hackathon mechanism. Professional-payment transactions never grant AI tokens. There is no escrow, custody wallet or automatic agent payment/refund. Sandbox functionality never establishes production account/country/partner eligibility.

Official references:
- https://developer.paypal.com/platforms/seller-onboarding/before-payment
- https://developer.paypal.com/platforms/checkout/standard/integrate
- https://developer.paypal.com/platforms/checkout/issue-refund
- https://developer.paypal.com/api/payments/v2/captures-refund
- https://developer.paypal.com/api/rest/webhooks/rest/

## Bryntum

The supplied key uses **Bryntum 8 Enterprise**, available from public npm. Matching Gantt/Calendar product and React wrapper packages are installed at exact `8.0.0` versions, sharing Enterprise core/grid/scheduler dependencies. Node modules and commercial distribution files remain ignored; only package references/lockfile and application adapter source are in the project.

`NEXT_PUBLIC_BRYNTUM_LICENSE_KEY` is read from `.env.local` and registered on `(globalThis.bryntum ??= {}).licenseKey` before the client-only dynamic imports create a component. It is a browser runtime licence, not an npm token. Actual keys stay out of committed source; the OpenAI API key must never use a `NEXT_PUBLIC_` variable.

Gantt renders persisted accepted/proposed scope plans, dependencies and owner progress. Tasks are manually scheduled for faithful date display; the widget is read-only. Date/dependency edits go through the existing proposal form and dual approval, preserving accepted records. Calendar renders current confirmed and pending meeting versions with different labels/colours and links to the meeting card. Drag/edit actions are disabled; proposals and responses remain the authoritative workflow. Trial badges remain visible; this is evaluation access, not a production licensing claim.

The targeted hosted browser test verifies both products mount without a licence mask, correct accepted task dates/dependencies and read-only state, separately proposed schedules, tentative/confirmed meeting events, escaped malicious names, cross-tab bundle coexistence and mobile overflow. Desktop/mobile screenshots were inspected; the compact mobile timeline shows task bars and dependency lines. The full hosted regression passed all three cases in 6.2 minutes.

Official references: [Bryntum 8 tiers/trials/public npm](https://bryntum.com/tiers-faq/), [React quick start and early key registration](https://www.bryntum.com/products/scheduler-next/docs/guide/Scheduler/quick-start/react). The old v7 private-registry/thin-package setup does not apply to the supplied v8 trial. Do not remove the watermark or redistribute distribution files beyond the vendor's licence terms.

## Remaining setup

- **PayPal:** `PAYPAL_CREDITS_*` merchant credentials and a sandbox buyer will be needed for the platform's prepaid AI credit checkout. A separately authorized sandbox seller and buyer will be needed for direct professional-payment tests. The sandbox professional-payment implementation needs the Partner merchant ID, BN code, an onboarded seller and a sandbox buyer; webhook delivery additionally needs a public HTTPS URL and registered webhook ID. Commission entitlement is not requested. Provider-backed end-to-end verification remains pending. No public tunnel, webhook registration, live charge or deployment has been created.
- **OpenAI:** key/model are present and the approved synthetic provider test passed. Local `AI_ENABLED=true` is recorded in PROGRESS.md; individual requests still require explicit invocation/budget confirmation. Private agents need separately purchased credits; no free private allowance is added.
- **Bryntum:** runtime key is present and evaluation rendering is verified. Track the vendor's trial period and obtain the appropriate production licence before deployment.

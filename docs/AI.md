# Agent execution and credit accounting

Three configurations live inside the same Next.js deployment. Explicit user invocation is required. There is no agent-to-agent handoff, background summarisation or automatic charge. Project advice appears to both parties; private advice stays within the invoking party's context. Summaries show their last successful refresh and never become commitments.

## Tool inventory and access

The model has one tool: `search_evidence(query)`. It cannot choose an engagement, identity, visibility, model, price, budget or executable action. The authenticated endpoint fixes those from verified membership, environment configuration and immutable pricing. The database independently checks the caller's engagement and role on retrieval. At most one retrieval tool call and one structured answer request execute.

| Context | Shared messages, agreements, TXT/CSV | Client private sources | Professional private sources | Billing account |
| --- | --- | --- | --- | --- |
| Project agent | Read | Denied | Denied | Shared |
| Client agent | Read | Read | Denied | Client |
| Professional agent | Read | Denied | Read | Professional |

No model tool can approve agreements, rewrite records, publish reviews, submit delivery, schedule binding commitments, pay or refund. All mutations require separate human forms. Copying a private draft requires selecting text, previewing the exact shared copy and confirming. No private history, evidence IDs or activity metadata is automatically copied to shared records.

Retrieval prioritises the exact currently accepted agreement and latest submitted proposal, then relevant authorised messages and extracted text. It returns up to ten sources and a 30 KB evidence budget. Each source includes immutable record/version, visibility, agreed/proposed/discussed state and an excerpt flag. Server validation rejects invented references, changed versions or mismatched visibility. Scope comparisons and summaries must cite the accepted agreement when available. This validates grounding references, not the truth or quality of every generated sentence; human review remains necessary.

Messages are append-only version 1. Attachment text uses the full file's SHA-256 version and stores up to 50,000 characters. TXT/CSV decoding is local, free, signature/UTF-8 checked and marked partial when clipped. PDF/images remain unsupported for agent analysis. Documents, filenames and retrieved text are untrusted data, never permission instructions. There is no URL fetching, code execution, external search, provider file store or vector index.

## Execution limits

The configured model is `gpt-6-luna` at Standard service tier. Versioned rates are $0.10/$0.01/$0.50 per million input/cache-read/output tokens, checked on 2026-11-05. Luna uses explicit-only caching with no breakpoints, disabling caching and cache writes; unexpected or unconfirmed cache usage is rejected. The original pinned `gpt-5-mini-2025-08-07` version remains supported at its recorded $0.25/$0.025/$2 rates. Each run has a 64 KB request cap, 512 retrieval-output tokens, 4096 answer-output tokens (including reasoning), low reasoning effort, two calls maximum, 45-second timeout per call and zero automatic SDK retries. Limits and actual rates determine the reservation; a model configuration without a valid pricing version cannot execute. The current maximum is below $0.10 of credits per run; the UI shows the exact maximum for confirmation.

The server claims an operation once, then records each provider response once using a unique response ID. Requests use `store:false`. A retry of the same idempotency key returns the saved status/result and cannot execute another model request. Changing the question creates a new key. Individual users are limited to six starts per minute and 200 per day; database limits are capped independently. No raw prompts, private retrieval bodies or credentials are written to console logs.

## Fair billing

USD nanodollars are integers. Input, cached input and output quantities use the immutable rate snapshot. Customer charge = actual verified provider cost × 2; cached inputs are not also billed as uncached inputs. The operation reserves from its own account only, allocating promotional credits before purchased lots. Unused reservations are released. No per-operation cent rounding, negative balances or cross-account borrowing occurs.

- Successful usable result: settle actual metered cost × 2 and publish the result atomically.
- Valid usable partial result: hold the quote for up to 24 hours. Only the initiating user can Keep and charge or Discard without charge. Declining/expiry clears the unpublished result and releases the reservation.
- Internal application error, unusable response, invalid structured output/citation, timeout, disconnect with uncertain usage, or cost exceeding the reservation: release customer units; platform absorbs attributable provider expense.
- Provider receipts record known expenses even for failed requests. Uncertain response IDs/usage are marked separately; no estimate is silently charged. Reconcile provider billing operationally. A failure while finalisation status is uncertain tells the user to refresh before retrying rather than promising a charge outcome that has not been confirmed.
- A service-authorised correction reverses a settled charge once, to its original credit sources, retaining the historical charge and receipt. The model cannot issue a correction.

A $5 promotional grant is atomic on a verified account's first engagement creation. Joining a project does not consume eligibility. Private balances start at zero. Shared usage/receipts are shared; private balances, receipts and detailed usage have account-scoped RLS and do not enter shared notifications or summaries. A service-only aggregate promotional-spend report supports monitoring without exposing individual private use.

Credit purchases, supported top-up amounts and refund holds are implemented as transactional records, not working checkout. PayPal verification/capture/webhook wiring is deferred until after the hackathon. A verified admin on the server-only `ADMIN_EMAILS` allowlist can add or remove available promotional demo credits through `/admin`; this creates audit/ledger records, never a fake purchase or provider receipt. Only service-only verified purchase settlement may mark real purchased credits. The platform plans to earn from prepaid AI credits used at 2× attributable provider cost. Direct-to-professional payments carry no Workspace commission. Unused whole-cent purchased credits can be held for a manual refund request, completed only after a verified provider refund. Promotional credits have no cash value; purchased credits have no invented expiration. See ARCHITECTURE.md.

## Recovery and validation status

`POST /api/maintenance` requires a server-held bearer secret (at least 32 characters, timing-safe comparison). It releases up to 100 expired reservations and clears expired partial offers. Running reservations expire after 15 minutes; partial offers after 24 hours. Configure a recurring deployment job; none is installed here. Recovery is safe to repeat. Requests still running after recovery cannot publish or charge against the released reservation.

Deterministic tests cover retrieval privacy, immutable extraction, operation claiming, tool-loop bounds, mocked SDK streaming/metering, citation validation, source allocation, concurrent reservations, refunds/corrections, failed settlement and recovery. Hosted Supabase tests cover actual storage/retrieval privacy and disabled-provider behaviour. The explicitly approved synthetic GPT-6 Luna provider test passed: two real Responses receipts, evidence citations, no private-context leakage, exact 2× ledger settlement and idempotent replay were verified. Provider cost was $0.0002166 and customer usage charge $0.0004332. This smoke test is not a broad assessment of output quality or production reliability. `AI_ENABLED=false` remains the environment-example default; local activation is recorded in PROGRESS.md. No mock result is exposed as a real model response.

import { boundedMilestoneEvidence } from "@/lib/ai/milestone-evidence";
import { after } from "next/server";
import { processQueuedAssessment } from "@/lib/ai/scope-monitor";
import { createHash } from "node:crypto";
import { z } from "zod";
import { authenticated } from "@/lib/supabase/server";
import { adminDatabase } from "@/lib/supabase/admin";
import { visibilitySchema } from "@/lib/domain";
import {
  agentModeSchema,
  evidenceSchema,
  resultBody,
} from "@/lib/ai/contracts";
import {
  reservationBudget,
  validateCacheUsage,
  type Price,
} from "@/lib/ai/pricing";
import { generateAgentResult } from "@/lib/ai/openai";
export const runtime = "nodejs";
export const maxDuration = 120;
const input = z.object({
  engagementId: z.uuid(),
  visibility: visibilitySchema,
  mode: agentModeSchema,
  question: z.string().trim().min(1).max(8000),
  operationKey: z.uuid(),
});
export async function POST(request: Request) {
  const allowedOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL || request.url)
    .origin;
  if (request.headers.get("origin") !== allowedOrigin)
    return Response.json({ error: "Invalid request origin" }, { status: 403 });
  let auth;
  try {
    auth = await authenticated();
  } catch {
    return Response.json(
      { error: "Sign in with a verified account." },
      { status: 401 },
    );
  }
  if (
    process.env.AI_ENABLED !== "true" ||
    !process.env.OPENAI_API_KEY ||
    !process.env.OPENAI_MODEL
  )
    return Response.json(
      {
        error: "AI setup is incomplete. Human collaboration remains available.",
      },
      { status: 503 },
    );
  if (Number(request.headers.get("content-length") || 0) > 40000)
    return Response.json({ error: "Request too large" }, { status: 413 });
  let value;
  try {
    if (!request.body) throw new Error();
    const reader = request.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "";
    let size = 0;
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > 40000) {
          await reader.cancel();
          throw new Error();
        }
        text += decoder.decode(chunk, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    value = input.parse(JSON.parse(text));
  } catch {
    return Response.json(
      { error: "Check your question and agent context." },
      { status: 400 },
    );
  }
  const { db, user } = auth;
  const membership = await db
    .from("memberships")
    .select("role")
    .eq("engagement_id", value.engagementId)
    .eq("user_id", user.id)
    .single();
  if (
    membership.error ||
    (value.visibility !== "shared" && value.visibility !== membership.data.role)
  )
    return Response.json(
      { error: "Agent context unavailable." },
      { status: 403 },
    );
  if (value.visibility === "shared" && (value.mode === "scope" || /\b(mediate|mediation|review (?:the )?(?:discussion|conversation))\b/i.test(value.question))) {
    const queued = await db.rpc("request_conversation_review_prompt", {e:value.engagementId,prompt:value.question});
    if (queued.error) return Response.json({error:"Discussion review could not be queued."},{status:409});
    after(() => processQueuedAssessment(value.engagementId));
    return Response.json({status:"review_queued",reviewId:queued.data});
  }
  let modelQuestion = value.question;
  if (value.visibility === "shared") {
    const findings = await db.from("conversation_findings").select("explanation,next_step,evidence,status").eq("engagement_id",value.engagementId).in("status",["open","awaiting_clarification"]).limit(20);
    if (findings.error) return Response.json({error:"Current shared findings could not be loaded."},{status:503});
    const advisory = JSON.stringify(findings.data);
    if (Buffer.byteLength(advisory) <= 12000) modelQuestion += "\nCurrent unresolved shared findings (advisory, not commitments; verify source records): " + advisory;
    else modelQuestion += "\nThe unresolved finding list exceeds this chat context; use Review discussion for current issues.";
  }
  let milestoneContext: z.infer<typeof evidenceSchema>[] | null = null;
  if (value.mode === "milestones") {
    if (value.visibility !== "shared") return Response.json({ error: "Milestone drafting uses the shared project agent." }, { status: 400 });
    const context = await db.rpc("milestone_agent_context", { e: value.engagementId });
    const parsed = z.array(evidenceSchema).safeParse(context.data);
    if (context.error || !parsed.success) return Response.json({ error: "The shared project context could not be loaded. Please retry." }, { status: 503 });
    try { milestoneContext = boundedMilestoneEvidence(parsed.data); }
    catch { return Response.json({error:"Too many shared sources for one milestone draft. Reduce the attached context before retrying."},{status:413}); }
    if (!milestoneContext.length) return Response.json({ error: "Add your project goals in shared Discussion or a supported shared file before drafting milestone descriptions." }, { status: 409 });
    modelQuestion += "\nDraft descriptions using shared goals, uploaded shared file contents and accepted terms. Explicitly identify unreadable files and incomplete excerpts. People will enter amounts and deadlines separately. Do not read private sources.";
  }
  const admin = adminDatabase();
  const priceResult = await admin
    .from("ai_pricing")
    .select("*")
    .eq("model", process.env.OPENAI_MODEL)
    .eq("enabled", true)
    .order("effective_at", { ascending: false })
    .limit(1)
    .single();
  if (priceResult.error)
    return Response.json(
      { error: "No verified pricing version is configured for this model." },
      { status: 503 },
    );
  const price = priceResult.data as Price;
  let budget: bigint;
  try {
    budget = reservationBudget(price);
    if (budget > 1000000000n) throw new Error();
  } catch {
    return Response.json(
      { error: "Model budget exceeds the configured operation limit." },
      { status: 503 },
    );
  }
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        e: value.engagementId,
        v: value.visibility,
        mode: value.mode,
        q: modelQuestion,
        model: price.model,
      }),
    )
    .digest("hex");
  const started = await admin.rpc("begin_agent_run", {
    e: value.engagementId,
    v: value.visibility,
    actor: user.id,
    question: modelQuestion,
    k: value.operationKey,
    budget: budget.toString(),
    price: price.id,
    hash,
    per_minute: 6,
    per_day: 200,
  });
  if (started.error) {
    const message = started.error.message;
    return Response.json(
      {
        error:
          message === "Insufficient credits"
            ? "This agent has insufficient tokens. Top up this balance to continue."
            : message === "AI rate limit reached"
              ? "AI rate limit reached. Please try later."
              : "The operation could not start. Refresh before retrying.",
      },
      { status: 409 },
    );
  }
  const run = await db
    .from("agent_runs")
    .select("id,status,result")
    .eq("id", started.data)
    .single();
  if (run.error)
    return Response.json({ error: "Agent run unavailable." }, { status: 409 });
  if (run.data.status !== "running")
    return Response.json({
      runId: run.data.id,
      status: run.data.status,
      result: run.data.result,
    });
  // A retry must never execute an existing running operation again.
  const claim = await admin.rpc("claim_agent_run", { op: started.data });
  if (claim.error || !claim.data)
    return Response.json(
      { runId: started.data, status: "running" },
      { status: 202 },
    );
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (data: unknown) => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
          } catch {
            closed = true;
          }
        }
      };
      try {
        const generated = await generateAgentResult(
          price,
          value.visibility,
          value.mode,
          modelQuestion,
          {
            started: async (responseId) => {
              await admin.rpc("mark_usage_uncertain", {
                op: started.data,
                response_id: responseId,
              });
            },
            search: async (query) => {
              if (milestoneContext) return milestoneContext;
              const found = await db.rpc("search_agent_evidence", {
                e: value.engagementId,
                v: value.visibility,
                q: query,
              });
              if (found.error) throw new Error("Evidence retrieval failed");
              return z.array(evidenceSchema).parse(found.data);
            },
            meter: async (response) => {
              if (!response.usage) {
                await admin.rpc("mark_usage_uncertain", {
                  op: started.data,
                  response_id: response.id,
                });
                throw new Error("Provider usage uncertain");
              }
              if (
                response.model !== price.model ||
                response.service_tier !== "default"
              )
                throw new Error("Unverified model or service tier");
              const usage = response.usage;
              validateCacheUsage(price, usage.input_tokens_details);
              const recorded = await admin.rpc("record_usage", {
                op_id: started.data,
                response_id: response.id,
                price: price.id,
                inputs: usage.input_tokens,
                cached: usage.input_tokens_details.cached_tokens,
                outputs: usage.output_tokens,
              });
              if (recorded.error) throw new Error("Usage recording failed");
            },
            preview: (answer) => emit({ type: "preview", answer }),
            status: (message) => emit({ type: "status", message }),
          },
          abort.signal,
        );
        const finished = await admin.rpc("finish_agent_run", {
          op: started.data,
          payload: generated.result,
          body: resultBody(generated.result),
          outcome: generated.partial ? "partial" : "success",
        });
        if (finished.error) throw new Error("Finalisation failed");
        const final = await db
          .from("agent_runs")
          .select("status,result")
          .eq("id", started.data)
          .single();
        if (
          final.error ||
          !["succeeded", "partial_offered"].includes(final.data.status)
        )
          throw new Error("Operation not completed");
        emit({
          type: "result",
          runId: started.data,
          status: final.data.status,
          result: final.data.result,
        });
      } catch {
        await admin.rpc("mark_usage_uncertain", { op: started.data });
        await admin.rpc("finish_agent_run", {
          op: started.data,
          payload: null,
          body: null,
          outcome: "internal_error",
          failure: "no_usable_result",
        });
        emit({
          type: "error",
          message:
            "The operation could not be confirmed. Refresh to check its result and credit status. Retrying the same operation will not execute it twice.",
        });
      } finally {
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminDatabase } from "@/lib/supabase/admin";
import { reservationBudget, type Price } from "./pricing";
export async function agentView(db: SupabaseClient, e: string, v: string) {
  const [credit, runs, price, conversation] = await Promise.all([
    db.rpc("credit_summary", { e, v }),
    db
      .from("agent_runs")
      .select("id,status,result,created_at,actor_id,output_message_id,question_message_id,failure_code")
      .eq("engagement_id", e)
      .eq("visibility", v)
      .order("created_at", { ascending: false })
      .limit(8),
    process.env.OPENAI_MODEL
      ? adminDatabase()
          .from("ai_pricing")
          .select("*")
          .eq("model", process.env.OPENAI_MODEL)
          .eq("enabled", true)
          .order("effective_at", { ascending: false })
          .limit(1)
          .single()
      : null,
    db
      .from("messages")
      .select("id,kind,body,created_at,author_id")
      .eq("engagement_id", e)
      .eq("visibility", v)
      .eq("channel", "agent")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(50),
  ]);
  let budgetNano: string | null = null;
  let setupReason: string | null =
    process.env.AI_ENABLED === "true" &&
    process.env.OPENAI_API_KEY &&
    process.env.OPENAI_MODEL
      ? null
      : "AI is not enabled for this workspace. No model request or usage charge will be made.";
  if (price) {
    if (price.error)
      setupReason =
        "Model pricing is not configured. The assistant remains paused.";
    else {
      try {
        const budget = reservationBudget(price.data as Price);
        if (budget > 1000000000n) throw new Error();
        budgetNano = budget.toString();
      } catch {
        setupReason =
          "This model exceeds the operation budget. The assistant remains paused.";
      }
    }
  }
  const runRows = runs.data || [];
  const partialIds = runRows
    .filter((r) => r.status === "partial_offered")
    .map((r) => r.id);
  const metering = partialIds.length
    ? await adminDatabase()
        .from("usage_operations")
        .select("id,provider_nano")
        .in("id", partialIds)
    : { data: [] };
  return {
    conversation: conversation.error
      ? null
      : conversation.data.slice().reverse(),
    summary: credit.error ? null : credit.data,
    budgetNano,
    setupReason,
    runs: runRows.map((r) => ({
      ...r,
      partialChargeNano:
        r.status === "partial_offered"
          ? (
              BigInt(
                metering.data?.find((m) => m.id === r.id)?.provider_nano || 0,
              ) * 2n
            ).toString()
          : null,
    })),
  };
}

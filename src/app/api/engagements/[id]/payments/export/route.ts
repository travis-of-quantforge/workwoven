import { z } from "zod";
import { authenticated } from "@/lib/supabase/server";
import { ledgerCsv, type LedgerEntry } from "@/lib/payment-ledger";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let auth;
  try {
    auth = await authenticated();
  } catch {
    return new Response("Sign in required", { status: 401 });
  }
  const parsed = z.uuid().safeParse((await params).id);
  if (!parsed.success) return new Response("Not found", { status: 404 });
  const { db, user } = auth;
  const member = await db
    .from("memberships")
    .select("role")
    .eq("engagement_id", parsed.data)
    .eq("user_id", user.id)
    .single();
  if (member.error) return new Response("Not found", { status: 404 });
  const entries: LedgerEntry[] = [];
  const last = await db
    .from("payment_ledger")
    .select("id")
    .eq("engagement_id", parsed.data)
    .order("id", { ascending: false })
    .limit(1);
  if (last.error) return new Response("Export unavailable", { status: 503 });
  const upper = last.data?.[0]?.id || 0;
  let cursor = 0;
  while (cursor < upper) {
    const page = await db
      .from("payment_ledger")
      .select("*")
      .eq("engagement_id", parsed.data)
      .gt("id", cursor)
      .lte("id", upper)
      .order("id")
      .limit(500);
    if (page.error) return new Response("Export unavailable", { status: 503 });
    if (!page.data.length) break;
    entries.push(...page.data);
    cursor = page.data.at(-1)!.id;
  }
  return new Response(ledgerCsv(entries), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payments-${parsed.data}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

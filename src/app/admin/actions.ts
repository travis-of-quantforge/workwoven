"use server";

import { revalidatePath } from "next/cache";
import { authenticated } from "@/lib/supabase/server";
import { adminDatabase } from "@/lib/supabase/admin";
import { isWorkspaceAdmin } from "@/lib/admin-access";
import { parseUsd } from "@/lib/domain";

export async function adjustDemoCredits(
  _previous: { error: string; success: boolean },
  form: FormData,
) {
  const { user } = await authenticated();
  if (!isWorkspaceAdmin(user)) throw new Error("Forbidden");
  try {
    const account = String(form.get("account") || "");
    const key = String(form.get("key") || "");
    const reason = String(form.get("reason") || "").trim();
    const direction = String(form.get("direction") || "");
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        account,
      ) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key,
      ) ||
      !["add", "remove"].includes(direction) ||
      reason.length < 3 ||
      reason.length > 500
    )
      throw new Error("Check the account, direction and reason.");
    const cents = parseUsd(form.get("amount"));
    if (cents < 1 || cents > 100000)
      throw new Error("Enter $0.01 to $1,000.00.");
    const delta = BigInt(cents) * 10000000n * (direction === "add" ? 1n : -1n);
    const { error } = await adminDatabase().rpc("admin_adjust_credits", {
      a: account,
      actor: user.id,
      k: key,
      delta: delta.toString(),
      why: reason,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/admin");
    return { error: "", success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Adjustment failed.",
      success: false,
    };
  }
}

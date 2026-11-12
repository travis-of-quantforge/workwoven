"use server";

import { revalidatePath } from "next/cache";
import { authenticated } from "@/lib/supabase/server";
import { adminDatabase } from "@/lib/supabase/admin";
import { isWorkspaceAdmin } from "@/lib/admin-access";
import { parseTokens, TOKEN_ATOMS } from "@/lib/ai/pricing";
import { z } from "zod";

export async function verifyUserEmail(
  _previous: { error: string; success: boolean },
  form: FormData,
) {
  const { user } = await authenticated();
  if (!isWorkspaceAdmin(user)) throw new Error("Forbidden");
  try {
    const subject = z.uuid().parse(form.get("user"));
    const service = adminDatabase();
    const target = await service.auth.admin.getUserById(subject);
    if (target.error || !target.data.user.email) throw new Error("User unavailable.");
    if (!target.data.user.email_confirmed_at) {
      const requested = await service.from("admin_activity").insert({ actor_id: user.id, subject_id: subject, action: "verify_email_requested" });
      if (requested.error) throw new Error("Could not record verification. Please retry.");
      const result = await service.auth.admin.updateUserById(subject, { email_confirm: true });
      if (result.error) throw new Error("Email verification failed. Please retry.");
      const completed = await service.from("admin_activity").insert({ actor_id: user.id, subject_id: subject, action: "verify_email_completed" });
      if (completed.error) throw new Error("Email verified; completion log could not be saved.");
    }
    revalidatePath("/admin");
    return { error: "", success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Verification failed.", success: false };
  }
}

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
    const atoms = parseTokens(form.get("amount"));
    if (atoms < TOKEN_ATOMS / 10n || atoms > 10000n * TOKEN_ATOMS)
      throw new Error("Enter 0.1 to 10,000 tokens.");
    const delta = atoms * (direction === "add" ? 1n : -1n);
    const { error } = await adminDatabase().rpc(form.get("target")==="wallet" ? "admin_adjust_account_tokens" : "admin_adjust_credits", {
      ...(form.get("target")==="wallet" ? {subject:account} : {a:account}),
      actor: user.id,
      k: key,
      delta: delta.toString(),
      why: reason,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/admin");
    revalidatePath("/");
    return { error: "", success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Adjustment failed.",
      success: false,
    };
  }
}

export async function setSignupTokens(_previous:{error:string;success:boolean},form:FormData) {
 const {user}=await authenticated();if(!isWorkspaceAdmin(user)) throw new Error("Forbidden");
 try {
  const amount=parseTokens(form.get("amount"));if(amount<0n || amount>10000n*TOKEN_ATOMS)throw new Error("Enter 0 to 10,000 tokens.");
  const {error}=await adminDatabase().rpc("admin_set_signup_tokens",{actor:user.id,k:z.uuid().parse(form.get("key")),amount:amount.toString()});
  if(error)throw new Error(error.message);revalidatePath("/admin");revalidatePath("/login");return {error:"",success:true};
 } catch(error){return {error:error instanceof Error?error.message:"Setting could not be saved.",success:false};}
}

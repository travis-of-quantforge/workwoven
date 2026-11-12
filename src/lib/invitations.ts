import "server-only";
import { createHash } from "node:crypto";
import { adminDatabase } from "@/lib/supabase/admin";

export async function activeInvitation(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const { data, error } = await adminDatabase()
    .from("invitations")
    .select("email,role")
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    .is("revoked_at", null)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error("Invitation status could not be checked. Please retry.");
  return data;
}

export async function invitationHasAccount(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const {data,error}=await adminDatabase().rpc("invitation_has_account",{t:token});
  if(error)throw new Error("Invitation account status could not be checked. Please retry.");
  return data===true;
}

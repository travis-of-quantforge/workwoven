"use server";
import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath, refresh } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import { contractTemplates } from "@/lib/contracts";
import { processQueuedAssessment } from "@/lib/ai/scope-monitor";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { adminDatabase } from "@/lib/supabase/admin";
import { safeFilename, validateUpload } from "@/lib/uploads";
import { authenticated, database } from "@/lib/supabase/server";
import {
  WorkspaceActionError,
  databaseActionError,
  actionErrorMessage,
} from "@/lib/action-errors";
import { localToUtc } from "@/lib/calendar";
import { sendInvitationEmail } from "@/lib/invitation-email";
import { activeInvitation } from "@/lib/invitations";
import { isWorkspaceAdmin } from "@/lib/admin-access";
import { milestonePlanSchema, changeSchema } from "@/lib/milestones";
import { parseUsd, scopeSchema, visibilitySchema } from "@/lib/domain";
import { paypalSetupReason, refreshSeller, onboardingLink, checkoutLink, reconcilePayment, executeRefund, cancelPayPalPayment } from "@/lib/paypal-service";
import { PayPalError } from "@/lib/paypal-api";
const id = (f: FormData) => z.uuid().parse(f.get("id"));
async function command(name: string, args: Record<string, unknown>) {
  const { db } = await authenticated();
  const { data, error } = await db.rpc(name, args);
  if (error) throw databaseActionError(error.code || "", error.message);
  return data;
}
export async function login(f: FormData) {
  const db = await database();
  const invitation = z.string().regex(/^[a-f0-9]{64}$/).optional().parse(f.get("invitation") || undefined);
  const invitationQuery = invitation ? `&invitation=${invitation}` : "";
  const adminLogin = !invitation && f.get("next") === "/admin";
  const nextQuery = adminLogin ? "&next=/admin" : "";
  const invited = invitation ? await activeInvitation(invitation) : null;
  if (invitation && !invited) redirect("/login?notice=This+invitation+is+no+longer+available.");
  const email = invited ? invited.email : z.email().parse(f.get("email"));
  const password = z.string().min(8).max(128).parse(f.get("password"));
  const signup = !adminLogin && f.get("mode") === "signup";
  if (signup && invitation && password !== f.get("confirmPassword"))
    redirect(`/login?mode=signup${invitationQuery}&notice=Passwords+do+not+match.+Please+try+again.`);
  const profileType = signup
    ? invited?.role || z.enum(["client", "professional"]).parse(f.get("profileType"))
    : null;
  let hourlyRate: number | null = null;
  if (signup && profileType === "professional" && f.get("hourlyRate")) {
    try {
      hourlyRate = z.number().int().min(1).max(100000000).parse(parseUsd(f.get("hourlyRate")));
    } catch {
      redirect(`/login?mode=signup${invitationQuery}&notice=Enter+a+valid+hourly+rate+in+USD.`);
    }
  }
  if (signup && invited && invitation) {
    const admin = adminDatabase();
    const created = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { profile_type: invited.role, hourly_rate_cents: hourlyRate },
    });
    if (created.error) {
      if (!["email_exists", "user_already_exists"].includes(created.error.code || ""))
        redirect(`/login?mode=signup${invitationQuery}&notice=${encodeURIComponent(created.error.message)}`);
      // Earlier versions may already have created an unconfirmed account.
      // The valid emailed invite proves email access; never replace its password.
      const pending = await admin.rpc("unverified_invited_user", { t: invitation });
      if (pending.error) throw new WorkspaceActionError("Account setup could not be completed. Please retry.");
      if (pending.data) {
        const confirmed = await admin.auth.admin.updateUserById(pending.data, { email_confirm: true });
        if (confirmed.error) throw new WorkspaceActionError("Account setup could not be completed. Please retry.");
      } else {
        redirect(`/login?mode=login${invitationQuery}&notice=If+you+already+have+an+account,+sign+in+with+your+existing+password.`);
      }
    }
    const signedIn = await db.auth.signInWithPassword({ email, password });
    if (signedIn.error) redirect(`/login?mode=login${invitationQuery}&notice=Sign+in+with+your+existing+password+to+continue.`);
    if (hourlyRate !== null) await command("set_hourly_rate", { cents: hourlyRate });
    const acceptance = new FormData();
    acceptance.set("token", invitation);
    await acceptInvite(acceptance);
  }
  const { error } =
    signup
      ? await db.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback${invitation ? `?invitation=${invitation}` : ""}`,
            data: { profile_type: profileType, hourly_rate_cents: hourlyRate },
          },
        })
      : await db.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?mode=${signup ? "signup" : "login"}${invitationQuery}${nextQuery}&notice=` + encodeURIComponent(error.message));
  if (adminLogin) {
    const { data: { user } } = await db.auth.getUser();
    if (!user || !isWorkspaceAdmin(user))
      redirect("/login?next=/admin&notice=This+account+does+not+have+admin+access.+Sign+in+with+an+admin+account.");
    redirect("/admin");
  }
  if (!signup && invitation) {
    const acceptance = new FormData();
    acceptance.set("token", invitation);
    await acceptInvite(acceptance);
  }
  redirect(
    signup
      ? `/login?notice=Check+your+email+to+verify+your+account.${invitationQuery}`
      : "/",
  );
}
export async function logout() {
  const db = await database();
  await db.auth.signOut();
  redirect("/login");
}
export async function switchRole(f: FormData) {
  const { db } = await authenticated();
  const nextRole = z.enum(["client", "professional"]).parse(f.get("role"));
  const { error } = await db.rpc("set_active_role", { next_role: nextRole });
  if (error) throw databaseActionError(error.code || "", error.message);
  revalidatePath("/");
  redirect("/");
}
export async function createEngagement(f: FormData) {
  const template=z.enum(["general","support","custom"]).parse(f.get("contractTemplate") || "general");
  const body=z.string().trim().min(20).max(20000).parse(f.get("contractBody") ?? contractTemplates.find(t=>t.id===template)!.body);
  const e = await command("create_engagement_with_contract", {
    p_title: z.string().trim().min(1).max(160).parse(f.get("title")),
    body,template,
  });
  redirect(`/workspace/${e}`);
}
export async function postMessage(f: FormData) {
  const e = id(f);
  const v = visibilitySchema.parse(f.get("visibility"));
  const b = z.string().trim().min(1).max(30000).parse(f.get("body"));
  const parent = f.get("parent") ? z.uuid().parse(f.get("parent")) : null;
  const mentions: string[] = [];
  const file = f.get("file");
  if (file instanceof File && file.size > 0) {
    await uploadMessageFile(e, v, b, parent, mentions, file);
  } else {
    await command("post_discussion_message", { e, v, b, parent, mentions });
  }
  if(v==="shared") after(()=>processQueuedAssessment(e));
  revalidatePath(`/workspace/${e}`);
}
export async function proposeContract(f:FormData) {
  const e=id(f);
  await command("propose_contract",{e,body:z.string().trim().min(20).max(20000).parse(f.get("body")),expected:z.uuid().nullable().parse(f.get("expected") || null),k:z.uuid().parse(f.get("operationKey"))});
  revalidatePath(`/workspace/${e}`);
}
export async function approveContract(f:FormData) {
  const e=id(f);
  const {db}=await authenticated();
  const v=z.uuid().parse(f.get("version"));
  const version=await db.from("contract_versions").select("engagement_id").eq("id",v).eq("engagement_id",e).single();
  if(version.error) throw new WorkspaceActionError("Contract unavailable.");
  await command("approve_contract",{v});revalidatePath(`/workspace/${e}`);
}
export async function setScopeMonitor(f:FormData) {
  const e=id(f);await command("set_scope_monitor",{e,enabled:z.enum(["true","false"]).parse(f.get("enabled"))==="true"});revalidatePath(`/workspace/${e}`);
}
export async function shareContent(f: FormData) {
  const e = id(f);
  if (f.get("confirmed") !== "yes")
    throw new Error("Review and confirm the selected content first.");
  await command("share_content", {
    e,
    b: z.string().trim().min(1).max(30000).parse(f.get("body")),
  });
  after(()=>processQueuedAssessment(e));
  revalidatePath(`/workspace/${e}`);
}
export async function submitScope(f: FormData) {
  const e = id(f);
  const { db } = await authenticated();
  const project = await db
    .from("engagements")
    .select("accepted_version_id")
    .eq("id", e)
    .single();
  if (project.error) throw new WorkspaceActionError("Engagement unavailable.");
  const prior = f.get("expected")
    ? await db
        .from("scope_versions")
        .select("content")
        .eq("id", z.uuid().parse(f.get("expected")))
        .eq("engagement_id", e)
        .single()
    : { data: null };
  const content = scopeSchema.parse({
    milestones: prior.data?.content.milestones,
    change: project.data.accepted_version_id
      ? changeSchema.parse({
          baseVersion: f.get("baseVersion"),
          reason: f.get("changeReason"),
          affectedReferences: f.get("affectedReferences"),
          costImpact: f.get("costImpact"),
          scheduleImpact: f.get("scheduleImpact"),
        })
      : undefined,
    ...Object.fromEntries(f),
    priceCents: parseUsd(f.get("priceUsd")),
    currency: "USD",
  });
  await command("submit_scope", {
    e,
    c: content,
    expected: f.get("expected") || null,
  });
  revalidatePath(`/workspace/${e}`);
}
export async function approveScope(f: FormData) {
  await command("approve_scope", { s: z.uuid().parse(f.get("version")) });
  revalidatePath(`/workspace/${id(f)}`);
}
export async function invite(f: FormData) {
  const e = id(f);
  const email = z.email().parse(f.get("email"));
  const token = await command("create_invitation", {
    e,
    target_email: email,
  });
  const { db } = await authenticated();
  const { data: engagement } = await db
    .from("engagements")
    .select("title")
    .eq("id", e)
    .single();
  const mail = await sendInvitationEmail(email, engagement?.title || "an engagement", token);
  redirect(`/workspace/${e}?tab=discussion&invite=${token}&mail=${mail}`);
}
export async function revokeInvitation(f: FormData) {
  const e = id(f);
  await command("revoke_invitation", { i: z.uuid().parse(f.get("invitation")) });
  redirect(`/workspace/${e}?tab=discussion`);
}
export async function openConcern(f: FormData) {
  const e = id(f);
  await command("open_concern", {
    e,
    t: z.string().trim().min(5).max(160).parse(f.get("title")),
    b: z.string().trim().min(10).max(5000).parse(f.get("description")),
    outcome: z.string().trim().min(3).max(3000).parse(f.get("desiredOutcome")),
    k: z.uuid().parse(f.get("operationKey")),
  });
  revalidatePath(`/workspace/${e}`);
}
export async function addConcernUpdate(f: FormData) {
  const e = id(f);
  await command("add_concern_update", {
    c: z.uuid().parse(f.get("case")),
    b: z.string().trim().min(1).max(5000).parse(f.get("body")),
    k: z.uuid().parse(f.get("operationKey")),
  });
  revalidatePath(`/workspace/${e}`);
}
export async function acknowledgeConcern(f: FormData) {
  const e = id(f);
  await command("acknowledge_concern", { c: z.uuid().parse(f.get("case")) });
  revalidatePath(`/workspace/${e}`);
}
export async function createPaymentRequest(f: FormData) {
  const e = id(f);
  const target = z.string().parse(f.get("target"));
  await command("create_payment_request", {
    e,
    expected: z.uuid().parse(f.get("version")),
    t: target === "balance" ? null : z.uuid().parse(target),
    k: z.uuid().parse(f.get("operationKey")),
  });
  revalidatePath(`/workspace/${e}`);
}
export async function requestAdhocPayment(f: FormData) {
  const e = id(f);
  await command("create_adhoc_payment_request", { e, category: z.enum(["bonus", "hourly", "adhoc"]).parse(f.get("category")),
    description: z.string().trim().min(1).max(2000).parse(f.get("description")), cents: parseUsd(f.get("amount")), k: z.uuid().parse(f.get("operationKey")) });
  revalidatePath(`/workspace/${e}`);
}
async function paymentMember(e: string, role?: string) {
  const auth = await authenticated();
  const member = await auth.db.from("memberships").select("role").eq("engagement_id", e).eq("user_id", auth.user.id).single();
  if (member.error || (role && member.data?.role !== role)) throw new WorkspaceActionError("You do not have permission for this payment action.");
  return auth;
}
export async function connectPayPalSeller(f: FormData) {
  const e = id(f), { user } = await paymentMember(e, "professional");
  let url: string;
  try { url = await onboardingLink(user.id, e); } catch (error) { if (error instanceof PayPalError) throw new WorkspaceActionError(error.message); throw error; }
  redirect(url);
}
export async function openPayPalSellerConnection(f: FormData) {
  try {
    const e = id(f), { user } = await paymentMember(e, "professional");
    return { url: await onboardingLink(user.id, e), error: "" };
  } catch (error) {
    unstable_rethrow(error);
    return { url: "", error: error instanceof PayPalError ? error.message : actionErrorMessage(error) };
  }
}
export async function verifyPayPalSeller(f: FormData) {
  const e = id(f), { user } = await paymentMember(e, "professional");
  await refreshSeller(user.id);
  revalidatePath(`/workspace/${e}`);
}
export async function requestMilestonePayment(f: FormData) {
  const e = id(f);
  await command("request_milestone_payment", { e, t: z.uuid().parse(f.get("task")), k: z.uuid().parse(f.get("operationKey")) });
  revalidatePath(`/workspace/${e}`);
}
export async function payWithPayPal(f: FormData) {
  const e = id(f), { db } = await paymentMember(e, "client");
  if (paypalSetupReason()) throw new WorkspaceActionError(paypalSetupReason()!);
  let requestId: string;
  if (f.get("description") !== null) requestId = await command("create_adhoc_payment_request", {
    e, category: "bonus", description: z.string().trim().min(1).max(2000).parse(f.get("description")),
    cents: parseUsd(f.get("amount")), k: z.uuid().parse(f.get("operationKey")),
  });
  else if (f.get("task")) requestId = await command("request_milestone_payment", { e, t: z.uuid().parse(f.get("task")), k: z.uuid().parse(f.get("operationKey")) });
  else requestId = z.uuid().parse(f.get("request"));
  const request = await db.from("payment_requests").select("payee_id,engagement_id").eq("id", requestId).eq("engagement_id", e).single();
  if (request.error) throw new WorkspaceActionError("Payment request unavailable.");
  await refreshSeller(request.data.payee_id);
  const p = await command("begin_paypal_payment", { q: requestId, k: z.uuid().parse(f.get("operationKey")) });
  let url: string;
  try { url = await checkoutLink(p, (await headers()).get("origin") || undefined); } catch (error) { if (error instanceof PayPalError) throw new WorkspaceActionError(error.message); throw error; }
  revalidatePath(`/workspace/${e}`);
  redirect(url);
}
export async function cancelPayPalCheckout(f: FormData) {
  const e = id(f), { db, user } = await paymentMember(e, "client");
  const p = z.uuid().parse(f.get("payment"));
  const payment = await db.from("payment_transactions").select("payer_id").eq("id", p).eq("engagement_id", e).single();
  if (payment.error || payment.data.payer_id !== user.id) throw new WorkspaceActionError("Payment unavailable.");
  try { await cancelPayPalPayment(p, user.id); }
  catch (error) { if (error instanceof PayPalError) throw new WorkspaceActionError(error.message); throw error; }
  finally { revalidatePath(`/workspace/${e}`); }
}
export async function updatePayPalPayment(f: FormData) {
  const e = id(f), { db, user } = await paymentMember(e);
  const p = z.uuid().parse(f.get("payment"));
  const payment = await db.from("payment_transactions").select("payer_id,payee_id").eq("id", p).eq("engagement_id", e).single();
  if (payment.error) throw new WorkspaceActionError("Payment unavailable.");
  const capture = f.get("capture") === "yes";
  if (capture && payment.data.payer_id !== user.id) throw new WorkspaceActionError("Only the client can complete a payment.");
  try { await reconcilePayment(p, capture, capture ? () => command("authorize_paypal_capture", { p }) : undefined); } catch (error) { if (error instanceof PayPalError) throw new WorkspaceActionError(error.message); throw error; }
  revalidatePath(`/workspace/${e}`);
}
export async function refundPayPalPayment(f: FormData) {
  const e = id(f), { db, user } = await paymentMember(e, "professional");
  const seller = await refreshSeller(user.id);
  if (!seller.refunds) throw new WorkspaceActionError("PayPal refund permission is missing. Reconnect the sandbox seller.");
  let refundId: string;
  if (f.get("refund")) {
    refundId = z.uuid().parse(f.get("refund"));
    const refund = await db.from("payment_refunds").select("actor_id").eq("id", refundId).eq("engagement_id", e).single();
    if (refund.error || refund.data.actor_id !== user.id) throw new WorkspaceActionError("Refund unavailable.");
  } else {
    const payment = await db.from("payment_transactions").select("id").eq("id",z.uuid().parse(f.get("payment"))).eq("engagement_id",e).eq("payee_id",user.id).single();
    if(payment.error) throw new WorkspaceActionError("Payment unavailable.");
    refundId = await command("begin_paypal_refund", { p: z.uuid().parse(f.get("payment")), cents: parseUsd(f.get("amount")), reason: z.string().trim().min(1).max(2000).parse(f.get("reason")), k: z.uuid().parse(f.get("operationKey")) });
  }
  try { await executeRefund(refundId); } catch (error) { if (error instanceof PayPalError) throw new WorkspaceActionError(error.message); throw error; }
  revalidatePath(`/workspace/${e}`);
}
export async function acceptInvite(f: FormData) {
  const token = z.string().regex(/^[a-f0-9]{64}$/).parse(f.get("token"));
  const session = await database();
  const { data: { user: currentUser } } = await session.auth.getUser();
  if (!currentUser?.email_confirmed_at)
    redirect(`/login?mode=signup&invitation=${token}`);
  // A browser may still be signed in as the inviter or another account.
  // Only inspect the invitation identified by the secret link; the RPC below
  // independently enforces email, expiry, membership and single-use rules.
  const invitation = await activeInvitation(token);
  if (invitation && invitation.email.toLowerCase() !== currentUser.email?.toLowerCase())
    redirect(`/login?mode=signup&invitation=${token}`);
  const e = await command("accept_invitation", {
    t: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(f.get("token")),
  });
  await finishInvitation(e);
}
export async function acceptReceivedInvite(f: FormData) {
  const e = await command("accept_received_invitation", { invitation_id: z.uuid().parse(f.get("invitation")) });
  await finishInvitation(e);
}
async function finishInvitation(e: string) {
  const { db, user } = await authenticated();
  const { data: membership, error: membershipError } = await db
    .from("memberships")
    .select("role")
    .eq("engagement_id", e)
    .eq("user_id", user.id)
    .single();
  if (membershipError || !membership)
    throw new Error("Invitation accepted, but account context could not be updated.");
  const { error: roleError } = await db.rpc("set_active_role", {
    next_role: membership.role,
  });
  if (roleError) throw databaseActionError(roleError.code || "", roleError.message);
  revalidatePath("/");
  redirect(`/workspace/${e}`);
}
async function uploadMessageFile(
  e: string,
  v: z.infer<typeof visibilitySchema>,
  b: string,
  parent: string | null,
  mentions: string[],
  file: File,
) {
  const { db, user } = await authenticated();
  if (file.size === 0 || file.size > 20971520)
    throw new Error("Choose a file up to 20 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validationError = validateUpload(bytes, file.type);
  if (validationError) throw new WorkspaceActionError(validationError);
  const { data: path, error } = await db.rpc("register_attachment", {
    e,
    v,
    n: safeFilename(file.name),
    mime: file.type,
    bytes: file.size,
  });
  if (error) throw databaseActionError(error.code || "", error.message);
  const uploaded = await db.storage
    .from("engagement-files")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploaded.error) {
    await db.rpc("abort_attachment", { p: path });
    throw new WorkspaceActionError(
      "Upload did not finish. Please retry; no completed file was recorded.",
    );
  }
  const confirmation = await db.rpc("confirm_attachment_with_message", {
    p: path,
    b,
    parent,
    mentions,
  });
  if (confirmation.error) {
    const current = await db
      .from("attachments")
      .select("upload_status,source_message_id")
      .eq("object_path", path)
      .maybeSingle();
    if (current.error)
      throw new WorkspaceActionError(
        "The upload status is uncertain. Refresh before retrying the message.",
      );
    if (current.data?.upload_status !== "ready" || !current.data.source_message_id) {
      const removed = await db.storage.from("engagement-files").remove([path]);
      if (!removed.error) await db.rpc("abort_attachment", { p: path });
      throw databaseActionError(confirmation.error.code || "", confirmation.error.message);
    }
  }
  if (!confirmation.error && !confirmation.data)
    throw new WorkspaceActionError(
      "The upload status is uncertain. Refresh before retrying the message.",
    );
  const admin = adminDatabase();
  if (["text/plain", "text/csv"].includes(file.type)) {
    const decoded = new TextDecoder().decode(bytes);
    const body = decoded.slice(0, 50000).replace(/[\uD800-\uDBFF]$/, "");
    const extracted = await admin.rpc("store_attachment_text", {
      p: path,
      actor: user.id,
      body,
      hash: createHash("sha256").update(bytes).digest("hex"),
      is_complete: body.length === decoded.length,
    });
    if (extracted.error)
      await admin
        .from("attachments")
        .update({ extraction_status: "error" })
        .eq("object_path", path)
        .eq("owner_id", user.id);
  } else
    await admin
      .from("attachments")
      .update({ extraction_status: "unsupported" })
      .eq("object_path", path)
      .eq("owner_id", user.id);
}
export async function downloadFile(f: FormData) {
  const { db } = await authenticated();
  const { data: a, error } = await db
    .from("attachments")
    .select("object_path,name,upload_status")
    .eq("id", z.uuid().parse(f.get("attachment")))
    .single();
  if (error || !a || a.upload_status !== "ready")
    throw new WorkspaceActionError("File unavailable or upload not confirmed.");
  const { data, error: downloadError } = await db.storage
    .from("engagement-files")
    .createSignedUrl(a.object_path, 60, { download: a.name });
  if (downloadError || !data) throw new Error("Download unavailable");
  redirect(data.signedUrl);
}

export async function markRead(f: FormData) {
  const e = id(f);
  await command("mark_discussion_read", {
    e,
    last_message: z.uuid().parse(f.get("lastMessage")),
  });
  revalidatePath(`/workspace/${e}`);
}
export async function markNotificationSeen(f: FormData) {
  await command("mark_notification_seen", {
    n: z.uuid().parse(f.get("notification")),
  });
  revalidatePath("/");
  revalidatePath(`/workspace/${id(f)}`);
  refresh();
}
export async function resolvePartial(f: FormData) {
  const e = id(f);
  await command("resolve_partial", {
    op_id: z.uuid().parse(f.get("operation")),
    keep: f.get("decision") === "keep",
  });
  revalidatePath(`/workspace/${e}`);
}
export async function requestCreditRefund(f: FormData) {
  const e = id(f);
  await command("request_credit_refund", {
    p: z.uuid().parse(f.get("purchase")),
    cents: parseUsd(f.get("amountUsd")),
    k: z.uuid().parse(f.get("operationKey")),
  });
  revalidatePath(`/workspace/${e}`);
}
export async function proposeMilestones(f: FormData) {
  const e = id(f);
  const raw = z
    .array(z.record(z.string(), z.unknown()))
    .max(30)
    .parse(JSON.parse(z.string().max(300000).parse(f.get("tasks"))));
  const tasks = milestonePlanSchema.parse(
    raw.map((t) => ({ ...t, amountCents: parseUsd(t.amountUsd) })),
  );
  await command("propose_milestones", {
    e,
    tasks,
    expected: z.uuid().parse(f.get("expected")),
    base: f.get("base") ? z.uuid().parse(f.get("base")) : null,
    reason: z.string().trim().min(1).max(3000).parse(f.get("reason")),
  });
  revalidatePath(`/workspace/${e}`);
}
export async function proposeSimpleMilestones(f: FormData) {
  const e = id(f);
  const expected = f.get("expected") ? z.uuid().parse(f.get("expected")) : null;
  const base = f.get("base") ? z.uuid().parse(f.get("base")) : null;
  const { db } = await authenticated();
  const project = await db.from("engagements").select("accepted_version_id").eq("id", e).single();
  if (project.error) throw new WorkspaceActionError("Engagement unavailable.");
  if (project.data.accepted_version_id !== base) throw new WorkspaceActionError("Accepted agreement changed; refresh");
  const previous = expected ? await db.from("scope_versions").select("content").eq("id", expected).eq("engagement_id", e).single() : { data: null, error: null };
  if (previous.error) throw new WorkspaceActionError("Stale version; refresh before submitting");
  const rows = z.array(z.object({ description: z.string().trim().min(1).max(5000), amountUsd: z.string(), targetDate: z.iso.date() })).min(1).max(30)
    .parse(JSON.parse(z.string().max(200000).parse(f.get("milestones"))));
  const today = new Date().toISOString().slice(0, 10);
  const milestones = milestonePlanSchema.parse(rows.map((row) => ({
    key: randomUUID(), title: row.description.slice(0, 200), owner: "professional",
    startDate: row.targetDate < today ? row.targetDate : today, endDate: row.targetDate,
    acceptanceCriteria: row.description, paymentTerms: "Due on client acceptance of this milestone.",
    amountCents: parseUsd(row.amountUsd), dependencies: [],
  })));
  const priceCents = milestones.reduce((sum, milestone) => sum + milestone.amountCents, 0);
  const prior = previous.data?.content || {};
  const content = scopeSchema.parse({
    ...prior,
    deliverables: rows.map((row, index) => `${index + 1}. ${row.description}`).join("\n"),
    exclusions: prior.exclusions || "Work outside these milestones requires a separately approved revision.",
    assumptions: prior.assumptions || "Milestone amounts are fixed prices; hourly rates inform estimates only.",
    responsibilities: prior.responsibilities || "Provide necessary inputs and review milestone deliveries.",
    acceptanceCriteria: rows.map((row, index) => `${index + 1}. Client reviews delivery against: ${row.description}`).join("\n"),
    priceCents, currency: "USD", paymentTerms: "Each milestone amount is due when the client accepts its delivery.",
    schedule: rows.map((row, index) => `Milestone ${index + 1}: ${row.targetDate}`).join("\n"),
    milestones,
    change: base ? { baseVersion: base, reason: z.string().trim().min(1).max(3000).parse(f.get("reason")), affectedReferences: "Milestone deliverables, prices and target deadlines", costImpact: `Proposed total USD ${(priceCents / 100).toFixed(2)}; requires both parties' approval.`, scheduleImpact: "Target deadlines are listed per milestone in this revision." } : undefined,
  });
  await command("submit_scope", { e, c: content, expected });
  revalidatePath(`/workspace/${e}`);
}
export async function submitIndividualMilestones(f: FormData) {
  const e = id(f);
  const rows = z.array(z.object({
    description: z.string().trim().min(1).max(5000),
    acceptanceCriteria: z.string().trim().min(1).max(5000),
    responsibilities: z.string().trim().max(5000),
    amountUsd: z.string(), targetDate: z.iso.date(),
  })).min(1).max(30).parse(JSON.parse(z.string().max(500000).parse(f.get("milestones"))));
  await command("submit_individual_milestones", {
    e, rows: rows.map(({ amountUsd, ...row }) => ({ ...row, amountCents: parseUsd(amountUsd) })),
    k: z.uuid().parse(f.get("operationKey")),
    m: f.get("milestone") ? z.uuid().parse(f.get("milestone")) : null,
    expected: f.get("expected") ? z.uuid().parse(f.get("expected")) : null,
    reason: z.string().trim().max(3000).parse(f.get("reason") || ""),
  });
  revalidatePath(`/workspace/${e}`);
}
export async function acceptMilestone(f: FormData) {
  await command("accept_milestone", { v: z.uuid().parse(f.get("version")) });
  revalidatePath(`/workspace/${id(f)}`);
}
export async function reportProgress(f: FormData) {
  await command("report_task_progress", {
    t: z.uuid().parse(f.get("task")),
    p: z.coerce.number().int().min(0).max(100).parse(f.get("percent")),
  });
  revalidatePath(`/workspace/${id(f)}`);
}
export async function submitDelivery(f: FormData) {
  const links = z
    .array(
      z
        .url()
        .max(2000)
        .refine(
          (s) =>
            new URL(s).protocol === "https:" &&
            !new URL(s).username &&
            !new URL(s).password,
        ),
    )
    .max(10)
    .parse(
      z
        .string()
        .max(20000)
        .parse(f.get("links"))
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  await command("submit_delivery", {
    t: z.uuid().parse(f.get("task")),
    b: z.string().trim().min(1).max(10000).parse(f.get("body")),
    links,
    files: z.array(z.uuid()).max(10).parse(f.getAll("file")),
    k: z.uuid().parse(f.get("operationKey")),
  });
  revalidatePath(`/workspace/${id(f)}`);
}
export async function reviewDelivery(f: FormData) {
  await command("review_delivery", {
    s: z.uuid().parse(f.get("submission")),
    decision: z
      .enum(["accepted", "changes_requested"])
      .parse(f.get("decision")),
    reason: z.string().trim().min(1).max(5000).parse(f.get("reason")),
  });
  revalidatePath(`/workspace/${id(f)}`);
}
export async function proposeMeeting(f: FormData) {
  const e = id(f),
    zone = z.string().max(100).parse(f.get("timezone"));
  let starts: string;
  try {
    starts = localToUtc(
      z.string().parse(f.get("local")),
      zone,
      z.enum(["earlier", "later", "reject"]).parse(f.get("occurrence")),
    );
  } catch (cause) {
    throw new WorkspaceActionError(
      cause instanceof Error ? cause.message : "Choose a valid meeting time.",
    );
  }
  const duration = z.coerce
    .number()
    .int()
    .min(5)
    .max(480)
    .parse(f.get("duration"));
  const url = z
    .union([
      z.literal(""),
      z
        .url()
        .max(2000)
        .refine(
          (s) =>
            new URL(s).protocol === "https:" &&
            !new URL(s).username &&
            !new URL(s).password,
        ),
    ])
    .parse(f.get("url"));
  await command("propose_meeting", {
    e,
    m: f.get("meeting") ? z.uuid().parse(f.get("meeting")) : null,
    expected: f.get("expected") ? z.uuid().parse(f.get("expected")) : null,
    title: z.string().trim().min(1).max(200).parse(f.get("title")),
    agenda: z.string().trim().min(1).max(5000).parse(f.get("agenda")),
    starts,
    ends: new Date(Date.parse(starts) + duration * 60000).toISOString(),
    zone,
    url,
    milestone: f.get("milestone") ? z.uuid().parse(f.get("milestone")) : null,
    k: z.uuid().parse(f.get("operationKey")),
  });
  revalidatePath(`/workspace/${e}`);
  revalidatePath("/calendar");
}
export async function respondMeeting(f: FormData) {
  await command("respond_meeting", {
    v: z.uuid().parse(f.get("version")),
    answer: z.enum(["accepted", "declined"]).parse(f.get("answer")),
    reason: z.string().trim().max(3000).parse(f.get("reason")),
  });
  revalidatePath(`/workspace/${id(f)}`);
  revalidatePath("/calendar");
}
export async function cancelMeeting(f: FormData) {
  await command("cancel_meeting", {
    m: z.uuid().parse(f.get("meeting")),
    expected: z.uuid().parse(f.get("expected")),
    reason: z.string().trim().min(1).max(3000).parse(f.get("reason")),
  });
  revalidatePath(`/workspace/${id(f)}`);
  revalidatePath("/calendar");
}
export async function addMeetingNote(f: FormData) {
  await command("add_meeting_note", {
    v: z.uuid().parse(f.get("version")),
    b: z.string().trim().min(1).max(10000).parse(f.get("body")),
    k: z.uuid().parse(f.get("operationKey")),
  });
  revalidatePath(`/workspace/${id(f)}`);
  revalidatePath("/calendar");
}
export async function saveProfile(f: FormData) {
  const { user } = await authenticated();
  const hourlyRate = f.get("hourlyRate") ? z.number().int().min(1).max(100000000).parse(parseUsd(f.get("hourlyRate"))) : null;
  await command("update_profile", {
    n: z.string().trim().min(1).max(100).parse(f.get("displayName")),
    company: z.string().max(160).parse(f.get("company")),
    bio: z.string().max(3000).parse(f.get("bio")),
    skills: z
      .array(z.string().min(1).max(80))
      .max(20)
      .parse(
        z
          .string()
          .max(2000)
          .parse(f.get("skills"))
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    is_public: f.get("isPublic") === "yes",
  });
  if (f.has("hourlyRate")) await command("set_hourly_rate", {
    cents: hourlyRate,
  });
  revalidatePath("/profile");
  revalidatePath(`/people/${user.id}`);
}
export async function engagementOutcome(f: FormData) {
  await command("close_engagement", {
    e: id(f),
    target: z.enum(["completed", "cancelled"]).parse(f.get("outcome")),
    expected: f.get("expected") ? z.uuid().parse(f.get("expected")) : null,
    reason: z.string().trim().min(1).max(3000).parse(f.get("reason")),
  });
  revalidatePath(`/workspace/${id(f)}`);
  revalidatePath("/");
}
export async function submitReview(f: FormData) {
  const d = Object.fromEntries(
    [
      "communication",
      "clarity",
      "delivery",
      "collaboration",
      "honouringAgreements",
    ]
      .filter((key) => f.has(key))
      .map((key) => [
        key,
        z.coerce.number().int().min(1).max(5).parse(f.get(key)),
      ]),
  );
  await command("submit_review", {
    e: id(f),
    b: z.string().trim().min(20).max(5000).parse(f.get("body")),
    d,
  });
  revalidatePath(`/workspace/${id(f)}`);
}
export async function replyReview(f: FormData) {
  await command("reply_review", {
    r: z.uuid().parse(f.get("review")),
    b: z.string().trim().min(1).max(3000).parse(f.get("body")),
  });
  revalidatePath(`/workspace/${id(f)}`);
}
export async function reportReview(f: FormData) {
  await command("report_review", {
    r: z.uuid().parse(f.get("review")),
    reason: z.string().trim().min(10).max(3000).parse(f.get("reason")),
  });
  if (f.get("id")) revalidatePath(`/workspace/${id(f)}`);
  if (f.get("profile"))
    revalidatePath(`/people/${z.uuid().parse(f.get("profile"))}`);
}
export async function proposePortfolio(f: FormData) {
  await command("propose_portfolio", {
    e: id(f),
    t: z.string().trim().min(1).max(160).parse(f.get("title")),
    b: z.string().trim().min(1).max(3000).parse(f.get("body")),
    url: z
      .url()
      .max(2000)
      .refine(
        (s) =>
          new URL(s).protocol === "https:" &&
          !new URL(s).username &&
          !new URL(s).password,
      )
      .parse(f.get("url")),
  });
  revalidatePath(`/workspace/${id(f)}`);
}
export async function portfolioPermission(f: FormData) {
  await command("approve_portfolio", {
    p: z.uuid().parse(f.get("portfolio")),
    approve: f.get("allow") === "yes",
  });
  revalidatePath(`/workspace/${id(f)}`);
}
export async function portfolioVisibility(f: FormData) {
  await command("set_portfolio_visibility", {
    p: z.uuid().parse(f.get("portfolio")),
    publish: f.get("allow") === "yes",
  });
  revalidatePath(`/workspace/${id(f)}`);
}
export async function workspaceFormAction(
  _previous: { error: string; success: boolean },
  f: FormData,
) {
  const actions: Record<string, (data: FormData) => Promise<void>> = {
    profile: saveProfile,
    "engagement-outcome": engagementOutcome,
    review: submitReview,
    "review-reply": replyReview,
    "review-report": reportReview,
    "portfolio-proposal": proposePortfolio,
    "portfolio-permission": portfolioPermission,
    "portfolio-visibility": portfolioVisibility,
    "meeting-proposal": proposeMeeting,
    "meeting-response": respondMeeting,
    "meeting-cancel": cancelMeeting,
    "meeting-note": addMeetingNote,
    "milestone-plan": proposeMilestones,
    "simple-milestones": proposeSimpleMilestones,
    "individual-milestones": submitIndividualMilestones,
    "accept-milestone": acceptMilestone,
    progress: reportProgress,
    delivery: submitDelivery,
    "delivery-review": reviewDelivery,
    partial: resolvePartial,
    "credit-refund": requestCreditRefund,
    create: createEngagement,
    "contract-propose": proposeContract,
    "contract-approve": approveContract,
    "scope-monitor": setScopeMonitor,
    message: postMessage,
    share: shareContent,
    scope: submitScope,
    approve: approveScope,
    invite,
    "revoke-invite": revokeInvitation,
    "concern-open": openConcern,
    "concern-update": addConcernUpdate,
    "concern-acknowledge": acknowledgeConcern,
    "payment-request": createPaymentRequest,
    "adhoc-payment-request": requestAdhocPayment,
    "milestone-payment-request": requestMilestonePayment,
    "paypal-connect": connectPayPalSeller,
    "paypal-verify-seller": verifyPayPalSeller,
    "paypal-pay": payWithPayPal,
    "paypal-status": updatePayPalPayment,
    "paypal-cancel": cancelPayPalCheckout,
    "paypal-refund": refundPayPalPayment,
    accept: acceptInvite,
    "accept-received": acceptReceivedInvite,
    download: downloadFile,
    read: markRead,
    seen: markNotificationSeen,
  };
  const name = z.string().parse(f.get("_action"));
  const action = Object.hasOwn(actions, name) ? actions[name] : undefined;
  if (!action) return { error: "Unknown action.", success: false };
  try {
    await action(f);
    return { error: "", success: true };
  } catch (error) {
    unstable_rethrow(error);
    return { error: actionErrorMessage(error), success: false };
  }
}

"use server";
import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createHash } from "node:crypto";
import { adminDatabase } from "@/lib/supabase/admin";
import { safeFilename, validateUpload } from "@/lib/uploads";
import { authenticated, database } from "@/lib/supabase/server";
import {
  WorkspaceActionError,
  databaseActionError,
  actionErrorMessage,
} from "@/lib/action-errors";
import { localToUtc } from "@/lib/calendar";
import { milestonePlanSchema, changeSchema } from "@/lib/milestones";
import { parseUsd, scopeSchema, visibilitySchema } from "@/lib/domain";
const id = (f: FormData) => z.uuid().parse(f.get("id"));
async function command(name: string, args: Record<string, unknown>) {
  const { db } = await authenticated();
  const { data, error } = await db.rpc(name, args);
  if (error) throw databaseActionError(error.code || "", error.message);
  return data;
}
export async function login(f: FormData) {
  const db = await database();
  const email = z.email().parse(f.get("email"));
  const password = z.string().min(8).max(128).parse(f.get("password"));
  const { error } =
    f.get("mode") === "signup"
      ? await db.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
          },
        })
      : await db.auth.signInWithPassword({ email, password });
  if (error) redirect("/login?notice=" + encodeURIComponent(error.message));
  redirect(
    f.get("mode") === "signup"
      ? "/login?notice=Check+your+email+to+verify+your+account."
      : "/",
  );
}
export async function logout() {
  const db = await database();
  await db.auth.signOut();
  redirect("/login");
}
export async function createEngagement(f: FormData) {
  const e = await command("create_engagement", {
    p_title: z.string().trim().min(1).max(160).parse(f.get("title")),
    p_role: z.enum(["client", "professional"]).parse(f.get("role")),
  });
  redirect(`/workspace/${e}`);
}
export async function postMessage(f: FormData) {
  const e = id(f);
  await command("post_discussion_message", {
    e,
    v: visibilitySchema.parse(f.get("visibility")),
    b: z.string().trim().min(1).max(30000).parse(f.get("body")),
    parent: f.get("parent") ? z.uuid().parse(f.get("parent")) : null,
    mentions: z.array(z.uuid()).max(2).parse(f.getAll("mention")),
  });
  revalidatePath(`/workspace/${e}`);
}
export async function shareContent(f: FormData) {
  const e = id(f);
  if (f.get("confirmed") !== "yes")
    throw new Error("Review and confirm the selected content first.");
  await command("share_content", {
    e,
    b: z.string().trim().min(1).max(30000).parse(f.get("body")),
  });
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
  const token = await command("create_invitation", {
    e,
    target_email: z.email().parse(f.get("email")),
  });
  redirect(`/workspace/${e}?tab=discussion&invite=${token}`);
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
export async function acceptInvite(f: FormData) {
  const e = await command("accept_invitation", {
    t: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(f.get("token")),
  });
  redirect(`/workspace/${e}`);
}
export async function uploadFile(f: FormData) {
  const e = id(f);
  const { db, user } = await authenticated();
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > 20971520)
    throw new Error("Choose a file up to 20 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validationError = validateUpload(bytes, file.type);
  if (validationError) throw new WorkspaceActionError(validationError);
  const { data: path, error } = await db.rpc("register_attachment", {
    e,
    v: visibilitySchema.parse(f.get("visibility")),
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
  const confirmation = await db.rpc("confirm_attachment", { p: path });
  if (confirmation.error)
    throw new WorkspaceActionError(
      "The file was uploaded but confirmation failed. Please refresh before retrying.",
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
  revalidatePath(`/workspace/${e}`);
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
  revalidatePath("/profile");
  revalidatePath(`/people/${user.id}`);
}
export async function engagementOutcome(f: FormData) {
  if (f.get("confirmed") !== "yes")
    throw new WorkspaceActionError("Confirm the outcome for your party first.");
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
  if (f.get("confirmed") !== "yes")
    throw new WorkspaceActionError("Review and confirm your feedback first.");
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
    progress: reportProgress,
    delivery: submitDelivery,
    "delivery-review": reviewDelivery,
    partial: resolvePartial,
    "credit-refund": requestCreditRefund,
    create: createEngagement,
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
    accept: acceptInvite,
    upload: uploadFile,
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

import { authenticated } from "@/lib/supabase/server";
import { calendarInvitation } from "@/lib/calendar";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET(
  request: Request,
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
  const { db } = auth;
  const { data: m } = await db
    .from("meetings")
    .select("*")
    .eq("id", parsed.data)
    .single();
  if (!m) return new Response("Not found", { status: 404 });
  const { data: versions } = await db
    .from("meeting_versions")
    .select("*")
    .eq("meeting_id", m.id)
    .order("number", { ascending: false })
    .limit(1);
  const latest = versions?.[0];
  const requested =
    new URL(request.url).searchParams.get("version") ||
    m.accepted_version_id ||
    latest?.id;
  if (
    !requested ||
    (requested !== m.accepted_version_id && requested !== latest?.id)
  )
    return new Response("Current calendar version unavailable", {
      status: 404,
    });
  const { data: v } = await db
    .from("meeting_versions")
    .select("*")
    .eq("id", requested)
    .eq("meeting_id", m.id)
    .single();
  if (!v) return new Response("Not found", { status: 404 });
  const { data: responses } = await db
    .from("meeting_responses")
    .select("response")
    .eq("version_id", v.id);
  const status =
    m.status === "cancelled" ||
    responses?.some((r) => r.response === "declined")
      ? "CANCELLED"
      : m.accepted_version_id === v.id
        ? "CONFIRMED"
        : "TENTATIVE";
  const body = calendarInvitation({
    id: m.id,
    sequence: m.sequence,
    updatedAt: m.updated_at,
    start: v.starts_at,
    end: v.ends_at,
    title: v.title,
    agenda: v.agenda,
    status,
    timezone: v.timezone,
    url: v.meeting_url,
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="meeting-${m.id}.ics"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

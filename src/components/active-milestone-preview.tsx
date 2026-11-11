import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { activeMilestoneId } from "@/lib/milestones";
import { usd } from "@/lib/domain";

export async function ActiveMilestonePreview({ db, id, status }: { db: SupabaseClient; id: string; status: string }) {
  const empty = <section aria-label="Active milestone" className="rounded-lg border border-slate-200 bg-white p-4"><h3>Active milestone</h3><p className="muted text-sm mt-2">No active milestone.</p></section>;
  if (status !== "active") return empty;
  const [items, versions, tasks, deliveries] = await Promise.all([
    db.from("milestones").select("id,accepted_version_id").eq("engagement_id", id).order("created_at").order("id"),
    db.from("milestone_versions").select("id,task_id,number,milestones!milestone_versions_milestone_id_fkey!inner(engagement_id)").eq("milestones.engagement_id", id),
    db.from("milestone_tasks").select("id,title,end_date,amount_cents").eq("engagement_id", id),
    db.from("delivery_submissions").select("id,task_id,milestone_tasks!inner(engagement_id)").eq("milestone_tasks.engagement_id", id),
  ]);
  const reviews = deliveries.data?.length ? await db.from("delivery_reviews").select("submission_id").in("submission_id", deliveries.data.map(d => d.id)).eq("decision", "accepted") : { data: [], error: null };
  if ([items, versions, tasks, deliveries, reviews].some(result => result.error))
    return <p role="alert" className="notice text-sm">Milestone preview could not be loaded.</p>;
  const completed = new Set(deliveries.data!.filter(d => reviews.data!.some(r => r.submission_id === d.id)).map(d => d.task_id));
  const activeId = activeMilestoneId(status, items.data!, versions.data!, tasks.data!, completed);
  if (!activeId) return empty;
  const item = items.data!.find(m => m.id === activeId)!;
  const version = versions.data!.find(v => v.id === item.accepted_version_id)!;
  const task = tasks.data!.find(t => t.id === version.task_id)!;
  return <section aria-label="Active milestone" className="rounded-lg border border-teal-700 bg-white p-4">
    <div className="flex items-center justify-between gap-3"><h3>Active milestone</h3><span className="badge">Version {version.number}</span></div>
    <p className="mt-3 text-sm font-medium line-clamp-3 break-words">{task.title}</p>
    <p className="muted text-xs mt-2">{usd(task.amount_cents)} · Due {task.end_date}</p>
    <Link className="inline-block underline text-xs mt-3" href={`/workspace/${id}?tab=milestones#milestone-${activeId}`}>View milestone</Link>
  </section>;
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { authenticated } from "@/lib/supabase/server";
import { adminDatabase } from "@/lib/supabase/admin";
import { isWorkspaceAdmin } from "@/lib/admin-access";

export const dynamic = "force-dynamic";

export default async function Conversations({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ engagement?: string; context?: string; page?: string }>;
}) {
  const auth = await authenticated().catch(() => null);
  if (!auth || !isWorkspaceAdmin(auth.user)) redirect("/login?next=/admin");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const query = await searchParams;
  const service = adminDatabase();
  const [target, memberships] = await Promise.all([
    service.auth.admin.getUserById(id),
    service.from("memberships").select("engagement_id,role").eq("user_id", id),
  ]);
  if (target.error || !target.data.user) notFound();
  if (memberships.error) throw new Error("Unable to load conversations.");
  const ids = memberships.data.map((m) => m.engagement_id);
  const projects = ids.length
    ? await service.from("engagements").select("id,title,status").in("id", ids).order("created_at", { ascending: false })
    : { data: [], error: null };
  if (projects.error) throw new Error("Unable to load engagements.");
  const selected = query.engagement || projects.data?.[0]?.id;
  const membership = memberships.data.find((m) => m.engagement_id === selected);
  if (query.engagement && !membership) notFound();
  const context = query.context === "private" ? "private" : "shared";
  const visibility = context === "private" ? membership?.role : "shared";
  const requestedPage = Number(query.page || 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 100000 ? requestedPage : 1;
  const base = `/admin/users/${id}/conversations`;
  const href = (engagement: string, nextContext = context, nextPage = 1) => `${base}?engagement=${engagement}&context=${nextContext}&page=${nextPage}`;
  let messages: { id: string; author_id: string; body: string; kind: string; created_at: string }[] = [];
  let hasMore = false;
  if (selected && membership) {
    // Admin access is separate from party permissions and never enters agent context.
    const audit = await service.from("admin_activity").insert({
      actor_id: auth.user.id, subject_id: id, engagement_id: selected,
      action: context === "private" ? "view_private_conversation" : "view_shared_conversation",
    });
    if (audit.error) throw new Error("Could not record conversation access. Please retry.");
    const result = await service.from("messages")
      .select("id,author_id,body,kind,created_at")
      .eq("engagement_id", selected).eq("visibility", visibility)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range((page - 1) * 50, page * 50);
    if (result.error) throw new Error("Unable to load messages.");
    hasMore = result.data.length > 50;
    messages = result.data.slice(0, 50).reverse();
  }
  const authorIds = [...new Set(messages.map((m) => m.author_id))];
  const authors = authorIds.length
    ? await service.from("profiles").select("id,display_name").in("id", authorIds)
    : { data: [], error: null };
  if (authors.error) throw new Error("Unable to load message authors.");
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Link href="/admin" className="text-sm underline">← Admin / Users</Link>
      <h1 className="mt-8">User conversations</h1>
      <p className="muted mt-3 break-all">{target.data.user.email}</p>
      <p className="muted mt-2 text-sm">Read-only admin access. Conversation views are recorded.</p>
      <div className="mt-8 grid gap-6 md:grid-cols-[16rem_1fr]">
        <nav aria-label="User engagements" className="stack content-start">
          {projects.data?.map((project) => (
            <Link key={project.id} href={href(project.id)} prefetch={false} aria-current={selected === project.id ? "page" : undefined} className={`panel break-words ${selected === project.id ? "border-teal-700" : ""}`}>
              {project.title}<span className="muted block mt-2 text-xs">{project.status}</span>
            </Link>
          ))}
          {!projects.data?.length && <p className="muted">No engagements yet.</p>}
        </nav>
        {selected && membership && <section className="min-w-0">
          <nav aria-label="Conversation visibility" className="flex flex-wrap gap-4 border-b pb-4">
            <Link href={href(selected, "shared")} prefetch={false} aria-current={context === "shared" ? "page" : undefined} className="underline">Shared discussion</Link>
            <Link href={href(selected, "private")} prefetch={false} aria-current={context === "private" ? "page" : undefined} className="underline">User’s private conversation</Link>
          </nav>
          <h2 className="my-5">{context === "private" ? `${membership.role} private conversation` : "Shared discussion"}</h2>
          <div className="stack">
            {messages.map((message) => <article key={message.id} className="panel">
              <div className="flex flex-wrap gap-2 text-xs muted">
                <span className={message.kind === "agent" ? "ai-text" : undefined}>{message.kind === "agent" ? "Agent" : message.kind === "system" ? "System" : authors.data?.find((a) => a.id === message.author_id)?.display_name || (message.author_id === id ? "This user" : "Counterparty")}</span>
                <time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</time>
              </div>
              <p className={`mt-3 whitespace-pre-wrap break-words ${message.kind === "agent" ? "ai-text" : ""}`}>{message.body}</p>
            </article>)}
            {!messages.length && <p className="muted">No messages in this conversation.</p>}
          </div>
          <nav aria-label="Message pages" className="mt-6 flex gap-4">
            {page > 1 && <Link href={href(selected, context, page - 1)} prefetch={false} className="underline">Newer messages</Link>}
            {hasMore && <Link href={href(selected, context, page + 1)} prefetch={false} className="underline">Older messages</Link>}
          </nav>
        </section>}
      </div>
    </main>
  );
}

import { ActionForm } from "@/components/action-form";
import { Notifications } from "@/components/notifications";
export const dynamic = "force-dynamic";
import Link from "next/link";
import {
  ArrowUpRight,
  Layers,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import { configured, database } from "@/lib/supabase/server";
import { isWorkspaceAdmin } from "@/lib/admin-access";
import { AccountMenu } from "@/components/account-menu";
import { Button } from "@/components/ui/button";
export default async function Home() {
  const db = configured() ? await database() : null;
  const user = db ? (await db.auth.getUser()).data.user : null;
  const invitations = user?.email_confirmed_at
    ? await db!.rpc("received_invitations")
    : { data: [], error: null };
  const { data: profile } = user
    ? await db!.from("profiles").select("active_role").eq("id", user.id).maybeSingle()
    : { data: null };
  const activeRole: "client" | "professional" =
    profile?.active_role === "professional" ? "professional" : "client";
  const { data: projects } = user
    ? await db!
        .from("engagements")
        .select("*,messages(body)")
        .eq("messages.visibility", "shared")
        .eq("messages.channel", "discussion")
        .order("created_at", { referencedTable: "messages", ascending: false })
        .order("id", { referencedTable: "messages", ascending: false })
        .limit(1, { referencedTable: "messages" })
        .order("created_at", { ascending: false })
    : { data: null };
  const { data: memberships } = user
    ? await db!
        .from("memberships")
        .select("engagement_id,role")
        .eq("user_id", user.id)
    : { data: [] };
  const visibleProjects = projects?.filter((p) =>
    memberships?.some((m) => m.engagement_id === p.id && m.role === activeRole),
  );
  const { data: notices } = user
    ? await db!
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50)
    : { data: [] };
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-wrap gap-4 items-center justify-between border-b border-slate-200 pb-6">
        <Link
          href="/"
          className="flex items-center gap-3 text-xl font-semibold"
        >
          <Layers size={25} className="text-teal-800" />
          {process.env.NEXT_PUBLIC_APP_NAME || "Workspace"}
        </Link>
        {user ? (
          <AccountMenu activeRole={activeRole} isAdmin={isWorkspaceAdmin(user)} />
        ) : (
          <Button asChild>
            <Link href="/login">
              Sign in <ArrowUpRight size={15} />
            </Link>
          </Button>
        )}
      </header>
      <div className="py-12">
        <p className="eyebrow mb-3">
          {user ? `${activeRole === "client" ? "Client" : "Professional"} workspace` : "Shared workspace"}
        </p>
        <h1>
          {user
            ? activeRole === "client"
              ? "Your client engagements"
              : "Your professional engagements"
            : "A shared place to move work forward."}
        </h1>
        <p className="muted mt-3 max-w-xl">
          {user
            ? activeRole === "client"
              ? "Develop a brief, invite a professional, and review work together."
              : "Plan delivery, invite a client, and keep the shared agreement clear."
            : "A shared workspace for clients and professionals. Discuss ideas, share files, agree on milestones and manage delivery together, with AI assistants to help along the way."}
        </p>
      </div>
      {user && !configured() && (
        <div className="notice mb-7">
          <strong>Connect your workspace</strong>
          <p>
            Supabase is not configured yet. Follow README.md to connect Auth,
            Postgres and Storage. No sample records are being presented as real
            engagements.
          </p>
        </div>
      )}
      {user && <Notifications items={notices || []} />}
      {user && invitations.error && <p role="alert" className="notice mb-6">Invitations could not be loaded. Refresh to retry.</p>}
      {!!invitations.data?.length && <section aria-label="Pending invitations" className="panel mb-7">
        <h2>Pending invitations</h2>
        {invitations.data.map((invitation: { id: string; title: string; role: string; expires_at: string }) => (
          <div key={invitation.id} className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
            <div>
              <h3>{invitation.title}</h3>
              <p className="muted text-sm">Invited as {invitation.role} · expires {new Date(invitation.expires_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</p>
            </div>
            <ActionForm actionName="accept-received">
              <input type="hidden" name="invitation" value={invitation.id} />
              <Button>Accept invitation</Button>
            </ActionForm>
          </div>
        ))}
      </section>}
      {user && <div className="space-y-7">
        <div className="panel mx-auto w-full max-w-xl py-10">
          <div className="text-center">
            <MessageSquare className="mx-auto mb-5 text-teal-700" size={30} />
            <h2>
              {visibleProjects?.length
                ? "Start another engagement"
                : `Your next ${activeRole === "client" ? "project" : "client engagement"} starts here`}
            </h2>
            <p className="muted mt-3">
              Create an engagement, develop a brief and invite your counterpart.
            </p>
          </div>
          <ActionForm actionName="create" className="stack mt-7">
            <div>
              <label htmlFor="title">Engagement name</label>
              <input
                name="title"
                id="title"
                placeholder="Reporting dashboard"
                maxLength={160}
                required
              />
            </div>
            <p className="muted text-sm">
              You will join as the {activeRole}. You can invite the{" "}
              {activeRole === "client" ? "professional" : "client"} after creation.
            </p>
            <Button>Create engagement</Button>
          </ActionForm>
          <div className="border-t border-slate-100 mt-6 pt-5 flex gap-2 text-xs muted">
            <ShieldCheck size={18} />
            <span>
              You approve for your party only. Private material stays private.
            </span>
          </div>
        </div>
        <section className="stack content-start">
          {visibleProjects?.map((p) => (
            <Link
              href={`/workspace/${p.id}`}
              key={p.id}
              className="panel hover:border-teal-600"
            >
              <div className="flex justify-between gap-4">
                <h2>{p.title}</h2>
                <ArrowUpRight size={18} />
              </div>
              <div className="mt-4 flex gap-3">
                <span className="badge">{p.status}</span>
                {p.funding === "pending" && (
                  <span className="badge">Funding pending</span>
                )}
              </div>
              {p.messages?.[0]?.body && <p className="muted mt-3 text-sm break-words">
                {Array.from(p.messages[0].body).slice(0, 100).join("")}
                {Array.from(p.messages[0].body).length > 100 ? "…" : ""}
              </p>}
            </Link>
          ))}
        </section>
      </div>}
    </div>
  );
}

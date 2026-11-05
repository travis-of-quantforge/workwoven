import { ActionForm } from "@/components/action-form";
import { Notifications } from "@/components/notifications";
export const dynamic = "force-dynamic";
import Link from "next/link";
import {
  ArrowUpRight,
  Layers,
  Plus,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import { configured, database } from "@/lib/supabase/server";
import { isWorkspaceAdmin } from "@/lib/admin-access";
import { logout } from "./actions";
import { Button } from "@/components/ui/button";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const role = (await searchParams).role;
  const db = configured() ? await database() : null;
  const user = db ? (await db.auth.getUser()).data.user : null;
  const { data: projects } = user
    ? await db!
        .from("engagements")
        .select("*")
        .order("created_at", { ascending: false })
    : { data: null };
  const { data: memberships } = user
    ? await db!
        .from("memberships")
        .select("engagement_id,role")
        .eq("user_id", user.id)
    : { data: [] };
  const visibleProjects = ["client", "professional"].includes(role || "")
    ? projects?.filter((p) =>
        memberships?.some((m) => m.engagement_id === p.id && m.role === role),
      )
    : projects;
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
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/profile" className="underline text-sm">
              Your profile
            </Link>
            <Link href="/calendar" className="underline text-sm">
              Your calendar
            </Link>
            {isWorkspaceAdmin(user) && <Link href="/admin" className="underline text-sm">Admin</Link>}
            <form action={logout}>
              <Button variant="outline">Sign out</Button>
            </form>
          </div>
        ) : (
          <Button asChild>
            <Link href="/login">
              Sign in <ArrowUpRight size={15} />
            </Link>
          </Button>
        )}
      </header>
      <div className="py-12">
        <p className="eyebrow mb-3">Your engagements</p>
        <h1>A shared place to move work forward.</h1>
        <p className="muted mt-3 max-w-xl">
          From the first conversation to the final delivery. Keep decisions,
          agreements and the people behind them connected.
        </p>
      </div>
      {!configured() && (
        <div className="notice mb-7">
          <strong>Connect your workspace</strong>
          <p>
            Supabase is not configured yet. Follow README.md to connect Auth,
            Postgres and Storage. No sample records are being presented as real
            engagements.
          </p>
        </div>
      )}
      {user && (
        <>
          <nav
            aria-label="Engagement role filters"
            className="flex flex-wrap gap-3 mb-5"
          >
            {[
              ["", "All engagements"],
              ["client", "As client"],
              ["professional", "As professional"],
            ].map(([r, label]) => (
              <Button
                key={r}
                asChild
                variant={(role || "") === r ? "default" : "outline"}
              >
                <Link href={r ? `/?role=${r}` : "/"}>{label}</Link>
              </Button>
            ))}
          </nav>
          <Notifications items={notices || []} />
        </>
      )}
      <div className="grid gap-7 md:grid-cols-[1fr_350px]">
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
                <span className="muted text-xs">
                  You are the{" "}
                  {memberships?.find((m) => m.engagement_id === p.id)?.role}
                </span>
                {p.funding === "pending" && (
                  <span className="badge">Funding pending</span>
                )}
              </div>
            </Link>
          ))}
          {!visibleProjects?.length && (
            <div className="panel py-14 text-center">
              <MessageSquare className="mx-auto mb-5 text-teal-700" size={30} />
              <h2>Your next collaboration starts here</h2>
              <p className="muted mt-3">
                Create an engagement, develop a brief and invite your
                counterpart.
              </p>
            </div>
          )}
        </section>
        <aside className="panel h-fit">
          <div className="flex items-center gap-2 mb-5">
            <Plus size={19} />
            <h2>New engagement</h2>
          </div>
          <ActionForm actionName="create" className="stack">
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
            <div>
              <label htmlFor="role">Your role in this engagement</label>
              <select name="role" id="role">
                <option value="client">Client</option>
                <option value="professional">Professional</option>
              </select>
            </div>
            <p className="muted text-xs">
              Your first verified creation includes $5 of shared AI credits.
              For this hackathon, later creations stay private until an admin
              allocates $5 of shared demo credits. Private AI needs its own
              allocation.
            </p>
            {user ? (
              <Button>Create engagement</Button>
            ) : (
              <Button asChild>
                <Link href="/login">Sign in to create</Link>
              </Button>
            )}
          </ActionForm>
          <div className="border-t border-slate-100 mt-6 pt-5 flex gap-2 text-xs muted">
            <ShieldCheck size={18} />
            <span>
              You approve for your party only. Private material stays private.
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}

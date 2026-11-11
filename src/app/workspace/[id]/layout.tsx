import { workspaceData } from "@/lib/workspace-data";
import { AccountMenu } from "@/components/account-menu";
import { isWorkspaceAdmin } from "@/lib/admin-access";
import { ReputationView } from "@/components/reputation-view";
import { LiveMessages } from "@/components/live-messages";
import { WorkspaceTabs } from "@/components/workspace-tabs";
import { Layers, ArrowLeft, LockKeyhole } from "lucide-react";
import Link from "next/link";

export default async function WorkspaceLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { db, user, project, members, role, activeRole, sidebarProjects, identities } = await workspaceData(id);
  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="bg-ivory border-r border-slate-200 p-4 md:p-6">
        <Link
          className="flex items-center gap-3 text-lg font-semibold"
          href="/"
        >
          <Layers className="text-teal-800" size={23} />
          {process.env.NEXT_PUBLIC_APP_NAME || "Workspace"}
        </Link>
        <Link
          href="/"
          className="flex items-center gap-2 muted mt-4 mb-3 md:mt-9 md:mb-8 text-xs"
        >
          <ArrowLeft size={13} />
          All engagements
        </Link>
        <p className="eyebrow mb-4 hidden md:block">Engagements</p>
        <nav className="flex gap-2 overflow-x-auto md:block">
          {sidebarProjects?.map((p) => (
            <Link
              key={p.id}
              href={`/workspace/${p.id}`}
              className={`block rounded-lg p-3 mb-2 text-sm ${p.id === id ? "bg-mint shadow-sm font-semibold text-teal-900" : "muted"}`}
            >
              {p.title}
            </Link>
          ))}
        </nav>
        <div className="mt-12 text-xs muted hidden md:block">
          <LockKeyhole size={17} className="mb-3" />
          Private assistants have separate histories and token balances.
        </div>
      </aside>
      <main className="min-w-0">
        <header className="bg-white border-b border-slate-200 px-6 lg:px-10 pt-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow mb-3">Engagement / {project.status}</p>
              <h1>{project.title}</h1>
              <p className="muted mt-3 text-xs">
                You are the {role} ·{" "}
                {members.length === 2
                  ? "Both parties joined"
                  : "Awaiting your counterpart"}
              </p>
            </div>
            <div className="text-xs muted">
              {identities.data?.map(
                (p: {
                  role: string;
                  display_name: string;
                  company: string;
                }) => (
                  <p key={p.role}>
                    {p.role}: {p.display_name}
                    {p.company ? ` · ${p.company}` : ""}
                  </p>
                ),
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="badge">
                {project.funding === "funded"
                  ? "Funded"
                  : "Private setup · funding pending"}
              </span>
              <AccountMenu activeRole={activeRole} isAdmin={isWorkspaceAdmin(user)} />
            </div>
          </div>
          <LiveMessages key={id} engagementId={id} />
          <WorkspaceTabs id={id} />
          {["discussion", "active"].includes(project.status) && <details className="my-4"><summary className="cursor-pointer text-sm">End engagement</summary><ReputationView db={db} id={id} role={role} userId={user.id} accepted={project.accepted_version_id} status={project.status} isDemo={project.is_demo} /></details>}
        </header>
        {children}
      </main>
    </div>
  );
}

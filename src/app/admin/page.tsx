import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { authenticated } from "@/lib/supabase/server";
import { adminDatabase } from "@/lib/supabase/admin";
import { isWorkspaceAdmin } from "@/lib/admin-access";
import { formatTokens } from "@/lib/ai/pricing";
import { CreditForm } from "./credit-form";
import { VerificationForm } from "./verification-form";

export const dynamic = "force-dynamic";

export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const auth = await authenticated().catch(() => null);
  if (!auth || !isWorkspaceAdmin(auth.user)) redirect("/login?next=/admin");

  const requested = Number((await searchParams).page || 1);
  const page = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  const service = adminDatabase();
  const usersResult = await service.auth.admin.listUsers({
    page,
    perPage: 100,
  });
  if (usersResult.error) throw new Error("Unable to load users.");
  const users = usersResult.data.users;
  const userIds = users.map((user) => user.id);
  const memberships = userIds.length
    ? await service
        .from("memberships")
        .select("engagement_id,user_id,role")
        .in("user_id", userIds)
    : { data: [], error: null };
  const profiles = userIds.length
    ? await service.from("profiles").select("id,display_name").in("id", userIds)
    : { data: [], error: null };
  if (memberships.error || profiles.error)
    throw new Error("Unable to load user details.");
  const engagementIds = [
    ...new Set((memberships.data || []).map((m) => m.engagement_id)),
  ];
  const projects = engagementIds.length
    ? await service
        .from("engagements")
        .select("id,title,funding")
        .in("id", engagementIds)
    : { data: [], error: null };
  const accounts = engagementIds.length
    ? await service
        .from("agent_accounts")
        .select("id,engagement_id,visibility,available_nano,reserved_nano")
        .in("engagement_id", engagementIds)
    : { data: [], error: null };
  if (projects.error || accounts.error)
    throw new Error("Unable to load agent balances.");

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <Link href="/" className="text-sm underline">
          ← Workspace
        </Link>
        <p className="eyebrow">Admin / Users</p>
      </header>
      <div className="py-8">
        <h1>Users and demo AI tokens</h1>
        <p className="muted mt-3 max-w-3xl">
          10 Workspace tokens equal $1 of AI credit value. These are separate from model input and output tokens. These
          manual adjustments are promotional, recorded in the ledger, and never
          marked as purchases. Shared balances are visible to both project
          parties; private balances remain party-private.
        </p>
      </div>
      <nav
        aria-label="Admin sections"
        className="mb-6 border-b border-slate-200 pb-3"
      >
        <span className="border-b-2 border-teal-700 pb-3 font-semibold">
          Users
        </span>
      </nav>
      <div className="stack">
        {users.map((user) => {
          const memberRows = (memberships.data || []).filter(
            (m) => m.user_id === user.id,
          );
          const name = (profiles.data || []).find(
            (p) => p.id === user.id,
          )?.display_name;
          return (
            <section key={user.id} className="panel">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2>{name || user.email || "Unnamed user"}</h2>
                <span className="muted text-xs">{user.email}</span>
              </div>
              <p className="muted mt-1 break-all text-xs">User ID: {user.id}</p>
              <p className="mt-3 text-sm">{user.email_confirmed_at ? "Email verified" : "Email unverified"}</p>
              {!user.email_confirmed_at && <VerificationForm userId={user.id} />}
              <Link href={`/admin/users/${user.id}/conversations`} prefetch={false} className="mt-3 inline-block text-sm underline">View conversations</Link>
              {!memberRows.length && (
                <p className="muted mt-4">No engagements yet.</p>
              )}
              {memberRows.map((member) => {
                const project = (projects.data || []).find(
                  (p) => p.id === member.engagement_id,
                );
                return (
                  <div
                    key={member.engagement_id}
                    className="mt-5 border-t border-slate-200 pt-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3>
                        <Link
                          className="underline"
                          prefetch={false}
                          href={`/admin/users/${user.id}/conversations?engagement=${member.engagement_id}`}
                        >
                          {project?.title || "Engagement"}
                        </Link>
                      </h3>
                      <span className="badge">
                        {member.role} · {project?.funding || "unknown funding"}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-4">
                      {(accounts.data || [])
                        .filter(
                          (account) =>
                            account.engagement_id === member.engagement_id &&
                            (account.visibility === "shared" ||
                              account.visibility === member.role),
                        )
                        .map((account) => (
                          <div
                            key={account.id}
                            className="rounded-lg border border-slate-200 p-4"
                          >
                            <p className="font-medium">
                              {account.visibility === "shared"
                                ? "Shared project agent"
                                : `${member.role} private agent`}
                            </p>
                            <p className="muted text-sm">
                              Available {formatTokens(account.available_nano)} ·
                              Reserved {formatTokens(account.reserved_nano)}
                            </p>
                            <CreditForm
                              accountId={account.id}
                              operationKey={randomUUID()}
                            />
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
        {!users.length && (
          <section className="panel">
            <p>No users on this page.</p>
          </section>
        )}
      </div>
      <nav aria-label="User pages" className="mt-8 flex gap-4 text-sm">
        {page > 1 && (
          <Link className="underline" href={`/admin?page=${page - 1}`}>
            Previous
          </Link>
        )}
        {users.length === 100 && (
          <Link className="underline" href={`/admin?page=${page + 1}`}>
            Next
          </Link>
        )}
      </nav>
    </main>
  );
}

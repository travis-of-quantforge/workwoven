import Link from "next/link";
import { redirect } from "next/navigation";
import { authenticated } from "@/lib/supabase/server";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { AccountMenu } from "@/components/account-menu";
import { isWorkspaceAdmin } from "@/lib/admin-access";
export default async function ProfilePage() {
  let auth;
  try {
    auth = await authenticated();
  } catch {
    redirect("/login");
  }
  const { data: p } = await auth.db
    .from("profiles")
    .select("*")
    .eq("id", auth.user.id)
    .maybeSingle();
  return (
    <main className="max-w-3xl mx-auto p-5 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link className="underline text-sm" href="/">← Workspace</Link>
        <AccountMenu activeRole={p?.active_role === "professional" ? "professional" : "client"} isAdmin={isWorkspaceAdmin(auth.user)} />
      </div>
      <h1 className="my-6">Your profile</h1>
      <section className="panel mb-5">
        <h2>Account context</h2>
        <p className="muted mt-3">You started as a {p?.default_role || "client"}. You are currently browsing as a {p?.active_role || "client"}. Use the account menu to switch; your role in existing engagements stays the same.</p>
      </section>
      <section className="panel">
        <p className="muted mb-5">
          One account can work as a client or professional. These fields become public only when you enable the public profile.
          Email, discussions, files, prices and private assistant activity stay
          private.
        </p>
        <ActionForm actionName="profile" className="stack">
          <label htmlFor="display-name">Display name</label>
          <input
            id="display-name"
            name="displayName"
            defaultValue={p?.display_name || ""}
            maxLength={100}
            required
          />
          <label htmlFor="company">
            Professional or company identity (optional)
          </label>
          <input
            id="company"
            name="company"
            defaultValue={p?.company || ""}
            maxLength={160}
          />
          <label htmlFor="bio">Public description</label>
          <textarea
            id="bio"
            name="bio"
            defaultValue={p?.public_bio || ""}
            maxLength={3000}
          />
          <label htmlFor="skills">
            Skills and services (one per line, up to 20)
          </label>
          <textarea
            id="skills"
            name="skills"
            defaultValue={p?.skills?.join("\n") || ""}
            maxLength={2000}
          />
          <label className="mention-option">
            <input
              type="checkbox"
              name="isPublic"
              value="yes"
              defaultChecked={p?.is_public || false}
            />
            <span>
              Make my profile, published feedback and eligible activity facts
              public
            </span>
          </label>
          <Button>Save profile and visibility</Button>
        </ActionForm>
        {p?.is_public && (
          <Link
            className="underline block mt-5"
            href={`/people/${auth.user.id}`}
          >
            View your public profile
          </Link>
        )}
      </section>
      <p className="notice mt-5 text-sm">
        Published feedback is frozen and cannot be removed by its subject. You
        can reply or report a policy issue. Turning your profile off hides the
        public page; feedback remains available to engagement participants.
      </p>
    </main>
  );
}

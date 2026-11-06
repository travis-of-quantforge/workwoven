import { redirect } from "next/navigation";
import Link from "next/link";
import { authenticated } from "@/lib/supabase/server";
import { CalendarView } from "@/components/calendar-view";
import { AccountMenu } from "@/components/account-menu";
import { isWorkspaceAdmin } from "@/lib/admin-access";
export default async function CalendarPage() {
  let auth;
  try {
    auth = await authenticated();
  } catch {
    redirect("/login");
  }
  const { data: profile } = await auth.db
    .from("profiles")
    .select("active_role")
    .eq("id", auth.user.id)
    .maybeSingle();
  return (
    <main className="max-w-5xl mx-auto px-5 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link className="underline text-sm" href="/">← Workspace</Link>
        <AccountMenu activeRole={profile?.active_role === "professional" ? "professional" : "client"} isAdmin={isWorkspaceAdmin(auth.user)} />
      </div>
      <h1 className="my-6">Your calendar</h1>
      <p className="muted mb-6 text-sm">Meetings from every engagement you belong to, across both profile types.</p>
      <CalendarView db={auth.db} userId={auth.user.id} />
    </main>
  );
}

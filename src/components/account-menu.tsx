import Link from "next/link";
import { logout, switchRole } from "@/app/actions";
import { Button } from "./ui/button";
import { Notifications } from "./notifications";
import { database } from "@/lib/supabase/server";

export async function AccountMenu({
  activeRole,
  isAdmin = false,
}: {
  activeRole: "client" | "professional";
  isAdmin?: boolean;
}) {
  const db = await database();
  const [notices, count] = await Promise.all([
    db.from("notifications").select("id,engagement_id,kind,record_id,seen_at,created_at,title").is("superseded_at",null).order("seen_at", {nullsFirst:true}).order("created_at", {ascending:false}).limit(50),
    db.from("notifications").select("id", {count:"exact", head:true}).is("superseded_at",null).is("seen_at", null),
  ]);
  const otherRole = activeRole === "client" ? "professional" : "client";
  return (
    <div className="flex items-center gap-3">
    <Notifications items={notices.data || []} unread={count.error ? null : count.count || 0} error={!!notices.error || !!count.error} />
    <details className="relative z-20 text-sm">
      <summary className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800">
        Account · {activeRole === "client" ? "Client" : "Professional"}
      </summary>
      <div className="absolute right-0 mt-2 w-56 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
        <p className="muted mb-3 text-xs">Browsing as {activeRole}</p>
        <form action={switchRole}>
          <input type="hidden" name="role" value={otherRole} />
          <Button variant="outline" className="w-full justify-start">
            Switch to {otherRole === "client" ? "Client" : "Professional"}
          </Button>
        </form>
        <nav className="mt-3 grid gap-2 border-t border-slate-100 pt-3">
          <Link href="/profile" className="underline">
            Your profile
          </Link>
          <Link href="/calendar" className="underline">
            Your calendar
          </Link>
          {isAdmin && (
            <Link href="/admin" className="underline">
              Admin
            </Link>
          )}
        </nav>
        <form action={logout} className="mt-3 border-t border-slate-100 pt-3">
          <Button variant="outline" className="w-full justify-start">
            Sign out
          </Button>
        </form>
      </div>
    </details>
    </div>
  );
}

import { redirect } from "next/navigation";
import Link from "next/link";
import { authenticated } from "@/lib/supabase/server";
import { CalendarView } from "@/components/calendar-view";
export default async function CalendarPage() {
  let auth;
  try {
    auth = await authenticated();
  } catch {
    redirect("/login");
  }
  return (
    <main className="max-w-5xl mx-auto px-5 py-8">
      <Link className="underline text-sm" href="/">
        ← All engagements
      </Link>
      <h1 className="my-6">Your calendar</h1>
      <CalendarView db={auth.db} userId={auth.user.id} />
    </main>
  );
}

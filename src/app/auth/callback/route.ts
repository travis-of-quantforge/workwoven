import { NextResponse } from "next/server";
import { database } from "@/lib/supabase/server";
import { acceptInvite } from "@/app/actions";
import { unstable_rethrow } from "next/navigation";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const db = await database();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) {
      const invitation = url.searchParams.get("invitation");
      if (invitation && /^[a-f0-9]{64}$/.test(invitation)) {
        const form = new FormData();
        form.set("token", invitation);
        try {
          await acceptInvite(form);
        } catch (error) {
          unstable_rethrow(error);
          return NextResponse.redirect(new URL(`/invite/${invitation}`, url.origin));
        }
      }
      return NextResponse.redirect(new URL("/", url.origin));
    }
  }
  return NextResponse.redirect(
    new URL("/login?notice=Verification+failed.+Please+try+again.", url.origin),
  );
}

import { NextResponse } from "next/server";
import { database } from "@/lib/supabase/server";
import { acceptInvite } from "@/app/actions";
import { unstable_rethrow } from "next/navigation";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const recovery = url.searchParams.get("next") === "/reset-password";
  if (code) {
    const db = await database();
    const flowId = url.searchParams.get("sb_flow_id");
    const { error } = flowId
      ? await db.auth.exchangeCodeForSession(code, { flowId })
      : await db.auth.exchangeCodeForSession(code);
    if (!error) {
      if (recovery) return NextResponse.redirect(new URL("/reset-password", url.origin));
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
    new URL(recovery
      ? "/forgot-password?notice=Your+reset+link+is+invalid+or+expired.+Request+a+new+link+and+open+it+in+the+same+browser."
      : "/login?notice=Verification+failed.+Please+try+again.", url.origin),
  );
}

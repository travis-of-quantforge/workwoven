import { NextResponse } from "next/server";
import { database } from "@/lib/supabase/server";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const db = await database();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/", url.origin));
  }
  return NextResponse.redirect(
    new URL("/login?notice=Verification+failed.+Please+try+again.", url.origin),
  );
}

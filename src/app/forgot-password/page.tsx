import Link from "next/link";
import { requestPasswordReset } from "./actions";
import { ActionSubmitButton } from "@/components/action-form";
import { configured } from "@/lib/supabase/server";

export default async function ForgotPassword({ searchParams }: {
  searchParams: Promise<{ notice?: string; sent?: string }>;
}) {
  const { notice, sent } = await searchParams;
  return <main className="mx-auto max-w-md px-5 py-20">
    <Link href="/" className="eyebrow">{process.env.NEXT_PUBLIC_APP_NAME || "Workspace"}</Link>
    <h1 className="mt-8 mb-3">Forgot your password?</h1>
    <p className="muted mb-7">Enter your account email and we’ll send you a password reset link.</p>
    {notice && <p role="alert" className="notice mb-4">{notice}</p>}
    {sent === "1" && <p role="status" className="panel mb-4">If an account exists for that email, you’ll receive a reset link. Check your spam folder too.</p>}
    <form action={requestPasswordReset} className="panel stack">
      <div><label htmlFor="email">Email</label><input id="email" name="email" type="email" maxLength={254} autoComplete="email" required /></div>
      <ActionSubmitButton disabled={!configured()} pendingLabel="Sending reset link…">Send reset link</ActionSubmitButton>
    </form>
    <p className="mt-5 text-sm"><Link className="underline" href="/login">Back to sign in</Link></p>
  </main>;
}

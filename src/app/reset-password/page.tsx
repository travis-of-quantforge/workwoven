import Link from "next/link";
import { resetPassword } from "@/app/forgot-password/actions";
import { database } from "@/lib/supabase/server";
import { ActionSubmitButton } from "@/components/action-form";

export const metadata = { referrer: "no-referrer", robots: { index: false, follow: false } } as const;

export default async function ResetPassword({ searchParams }: {
  searchParams: Promise<{ notice?: string; token_hash?: string }>;
}) {
  const { notice, token_hash } = await searchParams;
  const token = /^[a-f0-9]{56,64}$/i.test(token_hash || "") ? token_hash : undefined;
  const { data: { user }, error } = await (await database()).auth.getUser();
  return <main className="mx-auto max-w-md px-5 py-20">
    <Link href="/" className="eyebrow">{process.env.NEXT_PUBLIC_APP_NAME || "Workspace"}</Link>
    <h1 className="mt-8 mb-3">Reset your password</h1>
    {(!user || error) && !token ? <div className="panel stack">
      <p role="alert">Your reset link is missing, expired or already used. Request a new reset link.</p>
      <Link className="underline" href="/forgot-password">Request a new reset link</Link>
    </div> : <>
      <p className="muted mb-7">Choose a new password for your account.</p>
      {notice && <p role="alert" className="notice mb-4">{notice}</p>}
      <form action={resetPassword} className="panel stack">
        {token && <input type="hidden" name="tokenHash" value={token} />}
        <div><label htmlFor="password">New password</label><input id="password" name="password" type="password" minLength={8} maxLength={128} autoComplete="new-password" required /></div>
        <div><label htmlFor="confirmPassword">Confirm new password</label><input id="confirmPassword" name="confirmPassword" type="password" minLength={8} maxLength={128} autoComplete="new-password" required /></div>
        <ActionSubmitButton pendingLabel="Resetting password…">Reset password</ActionSubmitButton>
      </form>
    </>}
    <p className="mt-5 text-sm"><Link className="underline" href="/login">Back to sign in</Link></p>
  </main>;
}

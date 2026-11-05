import { login } from "@/app/actions";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { configured } from "@/lib/supabase/server";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { notice } = await searchParams;
  return (
    <main className="mx-auto max-w-md px-5 py-20">
      <Link href="/" className="eyebrow">
        {process.env.NEXT_PUBLIC_APP_NAME || "Workspace"}
      </Link>
      <h1 className="mt-8 mb-3">Good work starts with clarity.</h1>
      <p className="muted mb-7">
        Sign in to your shared client and professional workspace.
      </p>
      {notice && (
        <p role="status" className="notice mb-4">
          {notice}
        </p>
      )}
      {!configured() && (
        <p className="notice mb-4">
          Supabase setup required. Add the public URL and publishable key to
          .env.local, then apply the migrations.
        </p>
      )}
      <form action={login} className="panel stack">
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            minLength={8}
            autoComplete="current-password"
            required
          />
        </div>
        <Button name="mode" value="login" disabled={!configured()}>
          Sign in
        </Button>
        <Button
          variant="outline"
          name="mode"
          value="signup"
          disabled={!configured()}
        >
          Create account
        </Button>
        <small className="muted">
          Verify your email to claim your once-only $5 shared-agent starter
          grant on your first engagement.
        </small>
      </form>
    </main>
  );
}

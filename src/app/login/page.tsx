import { login } from "@/app/actions";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { configured } from "@/lib/supabase/server";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; mode?: string }>;
}) {
  const { notice, mode } = await searchParams;
  const signup = mode === "signup";
  return (
    <main className="mx-auto max-w-md px-5 py-20">
      <Link href="/" className="eyebrow">
        {process.env.NEXT_PUBLIC_APP_NAME || "Workspace"}
      </Link>
      <h1 className="mt-8 mb-3">{signup ? "Create your account" : "Welcome back"}</h1>
      <p className="muted mb-7">
        {signup
          ? "Choose the workspace you want to start in. You can switch later from your account menu."
          : "Sign in to continue your client or professional work."}
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
        <input type="hidden" name="mode" value={signup ? "signup" : "login"} />
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
            autoComplete={signup ? "new-password" : "current-password"}
            required
          />
        </div>
        {signup && (
          <div>
            <label htmlFor="profile-type">Start as</label>
            <select id="profile-type" name="profileType" defaultValue="client" required>
              <option value="client">Client</option>
              <option value="professional">Freelancer / professional</option>
            </select>
          </div>
        )}
        <Button disabled={!configured()}>{signup ? "Create account" : "Sign in"}</Button>
        <small className="muted">
          Verify your email to claim your once-only 50-token shared-agent starter
          grant on your first engagement.
        </small>
      </form>
      <p className="muted mt-5 text-sm">
        {signup ? "Already have an account? " : "New here? "}
        <Link className="underline" href={signup ? "/login" : "/login?mode=signup"}>
          {signup ? "Sign in" : "Create account"}
        </Link>
      </p>
    </main>
  );
}

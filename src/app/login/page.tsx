import { login } from "@/app/actions";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { configured } from "@/lib/supabase/server";
import { activeInvitation } from "@/lib/invitations";
import { redirect } from "next/navigation";
import { SignupProfileFields } from "@/components/signup-profile-fields";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; mode?: string; invitation?: string; next?: string }>;
}) {
  const { notice, mode, invitation: rawInvitation, next } = await searchParams;
  const invitation = /^[a-f0-9]{64}$/.test(rawInvitation || "") ? rawInvitation : undefined;
  const adminLogin = !invitation && next === "/admin";
  const signup = !adminLogin && mode === "signup";
  const invited = invitation ? await activeInvitation(invitation) : null;
  if (invitation && !invited) redirect("/login?notice=This+invitation+is+no+longer+available.");
  return (
    <main className="mx-auto max-w-md px-5 py-20">
      <Link href="/" className="eyebrow">
        {process.env.NEXT_PUBLIC_APP_NAME || "Workspace"}
      </Link>
      <h1 className="mt-8 mb-3">{adminLogin ? "Admin sign in" : signup ? "Create your account" : "Welcome back"}</h1>
      <p className="muted mb-7">
        {adminLogin ? "Sign in with your admin account to continue." : invited ? `${signup ? "Create a password" : "Sign in"} for ${invited.email} to join the workspace.` : signup
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
        {adminLogin && <input type="hidden" name="next" value="/admin" />}
        {invitation && <input type="hidden" name="invitation" value={invitation} />}
        {!invited && <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </div>}
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
        {signup && invited && (
          <div>
            <label htmlFor="confirm-password">Confirm password</label>
            <input id="confirm-password" name="confirmPassword" type="password" minLength={8} maxLength={128} autoComplete="new-password" required />
          </div>
        )}
        {signup && <SignupProfileFields invitedRole={invited?.role} />}
        <Button disabled={!configured()}>{signup ? "Create account" : "Sign in"}</Button>
        {!invitation && !adminLogin && <small className="muted">
          Verify your email to claim your once-only 50-token shared-agent starter
          grant on your first engagement.
        </small>}
      </form>
      {!adminLogin && <p className="muted mt-5 text-sm">
        {signup ? "Already have an account? " : "New here? "}
        <Link className="underline" href={`/login?mode=${signup ? "login" : "signup"}${invitation ? `&invitation=${invitation}` : ""}`}>
          {signup ? "Sign in" : "Create account"}
        </Link>
      </p>}
    </main>
  );
}

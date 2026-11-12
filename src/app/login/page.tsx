import { login } from "@/app/actions";
import { database } from "@/lib/supabase/server";
import { formatTokens } from "@/lib/ai/pricing";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { configured } from "@/lib/supabase/server";
import { activeInvitation, invitationHasAccount } from "@/lib/invitations";
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
  if (invited && invitation) {
    const {data:{user}}=await (await database()).auth.getUser();
    if(user?.email_confirmed_at && user.email?.toLowerCase()===invited.email.toLowerCase()) redirect(`/invite/${invitation}`);
    if(signup && await invitationHasAccount(invitation)) redirect(`/login?mode=login&invitation=${invitation}`);
  }
  const signupAllowance = signup && configured() ? await (await database()).from("account_token_settings").select("free_signup_nano").single() : null;
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
        {signup && signupAllowance?.data && BigInt(signupAllowance.data.free_signup_nano)>0n && <small className="muted">New accounts receive {formatTokens(signupAllowance.data.free_signup_nano)} free. Creating an engagement allocates 50 tokens to its shared project agent.</small>}
      </form>
      {!signup && <p className="mt-5 text-sm"><Link className="underline" href="/forgot-password">Forgot password?</Link></p>}
      {!adminLogin && <p className="muted mt-5 text-sm">
        {signup ? "Already have an account? " : "New here? "}
        <Link className="underline" href={`/login?mode=${signup ? "login" : "signup"}${invitation ? `&invitation=${invitation}` : ""}`}>
          {signup ? "Sign in" : "Create account"}
        </Link>
      </p>}
    </main>
  );
}

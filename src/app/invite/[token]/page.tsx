import {redirect} from "next/navigation";
import {database} from "@/lib/supabase/server";
import {activeInvitation,invitationHasAccount} from "@/lib/invitations";
import {AcceptInvitation} from "@/components/accept-invitation";
export default async function Invite({params}:{params:Promise<{token:string}>}) {
  const {token}=await params;
  const invited=await activeInvitation(token);
  if(!invited)redirect("/login?notice=This+invitation+is+no+longer+available.");
  const db=await database();
  const {data:{user}}=await db.auth.getUser();
  if(!user?.email_confirmed_at || user.email?.toLowerCase()!==invited.email.toLowerCase()) {
    const mode=await invitationHasAccount(token)?"login":"signup";
    redirect(`/login?mode=${mode}&invitation=${token}`);
  }
  return <main className="max-w-lg mx-auto py-20 px-5"><h1>Joining your engagement</h1><p className="muted my-5">Opening your shared workspace…</p><AcceptInvitation token={token}/></main>;
}

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
export default async function Invite({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="max-w-lg mx-auto py-20 px-5">
      <h1>Join your engagement</h1>
      <p className="muted my-5">
        Sign in with the verified email the invitation was sent to. Joining
        gives you access to shared content; the other party’s private material
        remains private.
      </p>
      <ActionForm actionName="accept">
        <input type="hidden" name="token" value={token} />
        <Button>Accept invitation</Button>
      </ActionForm>
      <a className="block mt-5 underline" href="/login">
        Sign in first
      </a>
    </main>
  );
}

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
        Accept to join the shared workspace. If you’re new, we’ll help you create
        an account first. Already have one? You can sign in along the way.
      </p>
      <ActionForm actionName="accept">
        <input type="hidden" name="token" value={token} />
        <Button>Accept invitation</Button>
      </ActionForm>
    </main>
  );
}

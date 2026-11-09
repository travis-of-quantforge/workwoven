"use client";
import { useActionState } from "react";
import { verifyUserEmail } from "./actions";
import { Button } from "@/components/ui/button";

export function VerificationForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(verifyUserEmail, { error: "", success: false });
  return (
    <form action={action} className="mt-3" aria-busy={pending}>
      <input type="hidden" name="user" value={userId} />
      <Button variant="outline" disabled={pending}>{pending ? "Verifying…" : "Verify email"}</Button>
      {state.error && <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>}
      {state.success && <p role="status" className="mt-2 text-sm">Email verified.</p>}
    </form>
  );
}

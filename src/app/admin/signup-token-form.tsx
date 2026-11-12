"use client";
import { useActionState } from "react";
import { setSignupTokens } from "./actions";
import { Button } from "@/components/ui/button";
export function SignupTokenForm({
  amount,
  operationKey,
}: {
  amount: string;
  operationKey: string;
}) {
  const [state, action, pending] = useActionState(setSignupTokens, {
    error: "",
    success: false,
  });
  return (
    <form action={action} className="panel mb-6" aria-busy={pending}>
      <label htmlFor="signup-tokens">Free tokens on account creation</label>
      <input type="hidden" name="key" value={operationKey} />
      <div className="flex flex-wrap gap-3 items-center">
        <input
          id="signup-tokens"
          name="amount"
          type="number"
          min="0"
          max="10000"
          step="0.00000001"
          defaultValue={amount}
          required
          className="max-w-48"
        />
        <Button disabled={pending}>
          {pending ? "Saving…" : "Save signup allowance"}
        </Button>
      </div>
      <p className="muted text-xs mt-3">
        Applies once to future signups. Existing grants are not repeated. Set 0
        to disable free signup tokens.
      </p>
      {state.error && (
        <p role="alert" className="notice mt-3">
          {state.error}
        </p>
      )}
      {state.success && !pending && (
        <p role="status" className="text-teal-800 mt-3">
          Saved.
        </p>
      )}
    </form>
  );
}

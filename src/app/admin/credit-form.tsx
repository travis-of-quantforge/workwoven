"use client";

import { useActionState } from "react";
import { adjustDemoCredits } from "./actions";
import { Button } from "@/components/ui/button";

export function CreditForm({
  accountId,
  operationKey,
  wallet = false,
}: {
  accountId: string;
  operationKey: string;
  wallet?: boolean;
}) {
  const [state, action, pending] = useActionState(adjustDemoCredits, {
    error: "",
    success: false,
  });
  return (
    <form
      action={action}
      className="mt-3 flex flex-wrap items-end gap-2"
      aria-busy={pending}
    >
      <input type="hidden" name="target" value={wallet ? "wallet" : "agent"} />
      <input type="hidden" name="account" value={accountId} />
      <input type="hidden" name="key" value={operationKey} />
      <label className="text-xs">
        Action
        <select
          name="direction"
          className="mt-1 block rounded-md border border-slate-300 p-2"
          required
        >
          <option value="add">Add demo tokens</option>
          <option value="remove">Remove demo tokens</option>
        </select>
      </label>
      <label className="text-xs">
        Workspace tokens
        <input
          name="amount"
          type="number"
          min="0.1"
          max="10000"
          step="0.00000001"
          required
          className="mt-1 block w-28 rounded-md border border-slate-300 p-2"
          placeholder="50"
        />
      </label>
      <label className="text-xs">
        Reason
        <input
          name="reason"
          minLength={3}
          maxLength={500}
          required
          className="mt-1 block min-w-48 rounded-md border border-slate-300 p-2"
          placeholder="Hackathon demo allocation"
        />
      </label>
      <Button disabled={pending}>{pending ? "Saving…" : "Apply"}</Button>
      {state.error && (
        <p role="alert" className="w-full text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state.success && !pending && (
        <p role="status" className="w-full text-sm text-teal-800">
          Saved. Refresh before another adjustment to this balance.
        </p>
      )}
    </form>
  );
}

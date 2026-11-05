"use client";
import { useActionState } from "react";
import { workspaceFormAction } from "@/app/actions";
export function ActionForm({
  actionName,
  children,
  className,
}: {
  actionName: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, action, pending] = useActionState(workspaceFormAction, {
    error: "",
    success: false,
  });
  return (
    <form action={action} className={className} aria-busy={pending}>
      <input type="hidden" name="_action" value={actionName} />
      <fieldset className="contents" disabled={pending}>
        {children}
      </fieldset>
      {pending && (
        <p role="status" className="muted text-xs mt-3">
          Saving…
        </p>
      )}
      {state.error && (
        <p role="alert" className="notice text-sm mt-3">
          {state.error}
        </p>
      )}
      {!pending && state.success && (
        <p role="status" className="text-teal-800 text-xs mt-3">
          Saved.
        </p>
      )}
    </form>
  );
}

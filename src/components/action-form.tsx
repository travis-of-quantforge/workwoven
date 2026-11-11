"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { Button } from "./ui/button";
import { workspaceFormAction } from "@/app/actions";

export function ActionSubmitButton({ children, pendingLabel = "Saving…", ...props }: React.ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return <Button {...props} type="submit" disabled={pending || props.disabled} aria-busy={pending}>
    {pending && <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
    {pending ? pendingLabel : children}
  </Button>;
}
export function ActionForm({
  actionName,
  children,
  className,
  submitOnCtrlEnter = false,
}: {
  actionName: string;
  children: React.ReactNode;
  className?: string;
  submitOnCtrlEnter?: boolean;
}) {
  const [state, action, pending] = useActionState(workspaceFormAction, {
    error: "",
    success: false,
  });
  return (
    <form action={action} className={className} aria-busy={pending} onKeyDown={submitOnCtrlEnter ? (event) => {
      if (event.key !== "Enter" || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing || !(event.target instanceof HTMLTextAreaElement)) return;
      event.preventDefault();
      if (!pending && !event.repeat) event.currentTarget.requestSubmit();
    } : undefined}>
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

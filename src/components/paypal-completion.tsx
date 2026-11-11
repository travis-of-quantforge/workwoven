"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { workspaceFormAction } from "@/app/actions";
import { Button } from "./ui/button";
import { Dialog } from "radix-ui";
import { LoaderCircle } from "lucide-react";
function completionData(engagementId: string, paymentId: string) {
  const data = new FormData();
  data.set("_action", "paypal-status");
  data.set("id", engagementId);
  data.set("payment", paymentId);
  data.set("capture", "yes");
  return data;
}

export function PayPalCompletion({
  engagementId,
  paymentId,
}: {
  engagementId: string;
  paymentId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState({ pending: true, error: "" });
  const job = useRef<ReturnType<typeof workspaceFormAction> | null>(null);
  useEffect(() => {
    let active = true;
    job.current ||= workspaceFormAction(
      { error: "", success: false },
      completionData(engagementId, paymentId),
    );
    void job.current
      .then((result) => {
        if (!active) return;
        setState({ pending: false, error: result.error });
        router.refresh();
      })
      .catch(() => {
        if (active)
          setState({
            pending: false,
            error:
              "Payment confirmation was interrupted. Retry confirmation; do not start a new payment.",
          });
      });
    return () => {
      active = false;
    };
  }, [engagementId, paymentId, router]);
  async function retry() {
    setState({ pending: true, error: "" });
    try {
      const result = await workspaceFormAction(
        { error: "", success: false },
        completionData(engagementId, paymentId),
      );
      setState({ pending: false, error: result.error });
      router.refresh();
    } catch {
      setState({
        pending: false,
        error:
          "Payment confirmation was interrupted. Retry confirmation; do not start a new payment.",
      });
    }
  }
  return (
    <Dialog.Root open>
      {/* Render inline so the fixed overlay is present in the initial HTML. */}
      <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/50" />
      <Dialog.Content
        className="fixed left-1/2 top-1/2 z-[101] w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-6 shadow-xl"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        aria-busy={state.pending}
      >
        {state.pending && (
          <LoaderCircle
            aria-hidden="true"
            className="mb-4 h-8 w-8 text-teal-800 motion-safe:animate-spin"
          />
        )}
        <Dialog.Title className="text-lg font-semibold">
          Confirming payment…
        </Dialog.Title>
        <Dialog.Description
          role={state.error ? "alert" : "status"}
          className={state.error ? "notice mt-3" : "muted mt-3"}
        >
          {state.error ||
            (state.pending
              ? "Checking PayPal approval and completing your payment…"
              : "Payment status updated. If confirmation is still pending, retry below.")}
        </Dialog.Description>
        {!state.pending && (
          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="button" className="mt-3" onClick={retry}>
              Retry payment confirmation
            </Button>
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={() =>
                router.replace(`/workspace/${engagementId}?tab=payments`)
              }
            >
              Back to payments
            </Button>
          </div>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

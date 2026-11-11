"use client";
import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
export function LiveMessages({ engagementId }: { engagementId: string }) {
  const router = useRouter();
  const [state, setState] = useState("connecting");
  useEffect(() => {
    let disposed = false;
    const db = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    );
    let channel: ReturnType<typeof db.channel> | undefined;
    async function connect() {
      const { data, error } = await db.auth.getSession();
      if (disposed) return;
      if (error || !data.session) {
        setState("unavailable");
        return;
      }
      // Joining before the browser session is loaded creates an anonymous subscription.
      // Keep callback-based token refresh active rather than pinning a single access token.
      await db.realtime.setAuth();
      if (disposed) return;
      // Async effect cleanup must not remove a replacement subscription using the same topic.
      channel = db
        .channel(`engagement:${engagementId}:${crypto.randomUUID()}`, {
          config: { postgres_changes_options: { wait: true } },
        })
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `engagement_id=eq.${engagementId}`,
          },
          () => {
            if (!disposed) router.refresh();
          },
        )
        .on("postgres_changes",{event:"UPDATE",schema:"public",table:"message_assessments",filter:`engagement_id=eq.${engagementId}`},()=>{if(!disposed) router.refresh();})
        .subscribe((status) => {
          if (disposed) return;
          if (status === "SUBSCRIBED") {
            setState("connected");
            router.refresh();
          } else if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          )
            setState("unavailable");
        });
    }
    void connect().catch(() => {
      if (!disposed) setState("unavailable");
    });
    return () => {
      disposed = true;
      if (channel) void db.removeChannel(channel);
    };
  }, [engagementId, router]);
  return (
    <p role="status" className="muted text-xs mt-3" data-live-state={state}>
      {state === "connected"
        ? "Live updates connected"
        : state === "connecting"
          ? "Connecting live updates…"
          : "Live updates unavailable. Refresh to load the latest messages."}
    </p>
  );
}

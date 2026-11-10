"use client";
import { useEffect, useRef } from "react";
import { markRead } from "@/app/actions";

export function DiscussionReadTracker({ engagementId, lastMessage }: { engagementId: string; lastMessage: string }) {
  const marker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let visible = false;
    let saved = false;
    let pending = false;
    let disposed = false;
    async function mark() {
      if (!visible || saved || pending || document.visibilityState !== "visible" || !document.hasFocus()) return;
      pending = true;
      const form = new FormData();
      form.set("id", engagementId);
      form.set("lastMessage", lastMessage);
      try {
        await markRead(form);
        saved = true;
      } catch {
        // Retry when the user returns to this discussion after a network failure.
      } finally {
        if (!disposed) pending = false;
      }
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      void mark();
    });
    if (marker.current) observer.observe(marker.current);
    document.addEventListener("visibilitychange", mark);
    window.addEventListener("focus", mark);
    return () => {
      disposed = true;
      observer.disconnect();
      document.removeEventListener("visibilitychange", mark);
      window.removeEventListener("focus", mark);
    };
  }, [engagementId, lastMessage]);
  return <div ref={marker} data-testid="discussion-read-marker" aria-hidden="true" className="h-px" />;
}

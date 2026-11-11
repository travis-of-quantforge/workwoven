"use client";

import { useLayoutEffect, useRef } from "react";

export function DiscussionScroll({ children, storageKey, initialBottom, focusedMessage, label = "Discussion messages" }: {
  children: React.ReactNode;
  storageKey: string;
  initialBottom: boolean;
  focusedMessage?: string;
  label?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(storageKey); } catch { /* Storage may be disabled. */ }
    const target = focusedMessage && document.getElementById(`message-${focusedMessage}`);
    if (target && element.contains(target)) {
      element.scrollTop += target.getBoundingClientRect().top - element.getBoundingClientRect().top - element.clientHeight / 3;
    } else if (saved !== null && Number.isFinite(Number(saved))) {
      element.scrollTop = Math.max(0, Number(saved));
    } else if (initialBottom) {
      element.scrollTop = element.scrollHeight;
    }
    const save = () => {
      try { sessionStorage.setItem(storageKey, String(element.scrollTop)); } catch { /* Scrolling still works without storage. */ }
    };
    save();
    element.addEventListener("scroll", save, { passive: true });
    window.addEventListener("pagehide", save);
    return () => {
      save();
      element.removeEventListener("scroll", save);
      window.removeEventListener("pagehide", save);
    };
  }, [storageKey, initialBottom, focusedMessage]);
  return <div ref={viewport} role="region" aria-label={label} tabIndex={0}
    className="discussion-scroll rounded focus-visible:outline-2 focus-visible:outline-teal-700">
    {children}
  </div>;
}

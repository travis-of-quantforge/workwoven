"use client";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useEffect, useRef } from "react";
import { ActionForm } from "./action-form";
import { Button } from "./ui/button";
type Notice = {
  id: string;
  engagement_id: string;
  kind: string;
  record_id: string;
  seen_at: string | null;
  created_at: string;
  title?: string | null;
};
export function Notifications({ items, unread, error = false }: { items: Notice[]; unread: number | null; error?: boolean }) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const close = () => { if (disclosure.current) disclosure.current.open = false; };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !disclosure.current?.contains(event.target)) close();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  return (
    <details ref={disclosure} className="relative z-30 shrink-0" onKeyDown={(event) => {
      if (event.key === "Escape") { close(); disclosure.current?.querySelector("summary")?.focus(); }
    }}>
        <summary role="button" className="relative flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-teal-600 [&::-webkit-details-marker]:hidden" aria-label={unread === null ? "Notifications" : `Notifications, ${unread} unread`}>
          <Bell size={20} aria-hidden="true" />
          {unread !== null && unread > 0 && <span aria-hidden="true" className="absolute -right-2 -top-2 min-w-5 rounded-full bg-red-600 px-1.5 py-0.5 text-center text-[11px] font-semibold leading-4 text-white">{unread}</span>}
        </summary>
        <div role="dialog" aria-label="Notifications" className="fixed left-4 right-4 top-20 mt-2 z-50 max-h-[70dvh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-lg sm:absolute sm:left-auto sm:right-0 sm:top-full sm:w-96">
          <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">Notifications</h2><Button type="button" variant="outline" className="px-2 py-1 text-xs" onClick={close}>Close</Button></div>
          {error ? <p role="alert" className="notice text-sm mt-4">Notifications could not be loaded. Refresh to retry.</p> : !items.length ? <p className="muted mt-4 text-sm">No notifications yet.</p> : items.map((n) => {
            const discussion = ["message", "reply", "mention"].includes(n.kind);
            const tab = discussion || ["invitation_accepted", "review_published"].includes(n.kind) ? "discussion" : n.kind === "concern" ? "concerns" : n.kind.startsWith("payment_") || n.kind === "refund_received" ? "payments" : n.kind.startsWith("meeting") ? "calendar" : "milestones";
            const label = n.title || ({payment_received:"Payment received",payment_sent:"Payment sent",refund_received:"Refund received",payment_request:"Payment requested"} as Record<string,string>)[n.kind] || n.kind.replaceAll("_", " ");
            return <div key={n.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 mt-4 pt-4">
              <div className="min-w-0">
                <Link onClick={close} className={`underline text-sm ${!n.seen_at ? "font-semibold text-teal-900" : "text-slate-600"}`} href={`/workspace/${n.engagement_id}?tab=${tab}${discussion ? `&message=${n.record_id}#message-${n.record_id}` : n.kind === "concern" ? `#concern-${n.record_id}` : ""}`}>{label}</Link>
                <p className="muted text-xs mt-1">{new Date(n.created_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</p>
              </div>
              {!n.seen_at && <ActionForm actionName="seen"><input type="hidden" name="id" value={n.engagement_id}/><input type="hidden" name="notification" value={n.id}/><Button variant="outline" className="px-2 py-1 text-xs">Mark seen</Button></ActionForm>}
            </div>;
          })}
          {items.length === 50 && <p className="muted text-xs mt-4">Showing 50 notifications, with unread items first.</p>}
        </div>
    </details>
  );
}

"use client";

import Link, { useLinkStatus } from "next/link";
import { useSearchParams } from "next/navigation";
import { LoaderCircle } from "lucide-react";

const tabs = ["discussion", "milestones", "contract", "files", "calendar", "concerns", "payments", "credits"];

function TabLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return <>
    <span className="grid">
      <span aria-hidden="true" className="invisible col-start-1 row-start-1">{label}</span>
      <span aria-hidden="true" className="invisible col-start-1 row-start-1 normal-case">Loading…</span>
      <span className={`col-start-1 row-start-1 ${pending ? "normal-case text-teal-800" : ""}`}>{pending ? "Loading…" : label}</span>
    </span>
    <span className="inline-flex w-4 shrink-0 items-center justify-center">
      {pending && <span role="status" aria-label="Loading tab"><LoaderCircle size={16} aria-hidden="true" className="animate-spin text-teal-700 motion-reduce:animate-none" /></span>}
    </span>
  </>;
}

export function WorkspaceTabs({ id }: { id: string }) {
  const query = useSearchParams();
  const requested = query.get("tab");
  const tab = requested === "agreement" ? "milestones" : tabs.includes(requested || "") ? requested : "discussion";
  return (
    <nav aria-label="Engagement tabs" className="flex gap-7 overflow-x-auto mt-7">
      {tabs.map((t) => (
        <Link key={t} href={`/workspace/${id}?tab=${t}`} scroll={false}
          aria-current={tab === t ? "page" : undefined}
          className={`relative inline-flex items-center gap-2 capitalize pb-4 border-b-2 text-sm whitespace-nowrap ${tab === t ? "border-teal-800 text-teal-900 font-semibold" : "border-transparent muted"}`}>
          <TabLabel label={t === "credits" ? "AI tokens" : t} />
        </Link>
      ))}
    </nav>
  );
}

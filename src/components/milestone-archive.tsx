"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { Button } from "./ui/button";
export type MilestoneHistory = {
  id: string;
  number: number;
  description: string;
  acceptanceCriteria: string;
  responsibilities: string;
  amountCents: number;
  targetDate: string;
  author: string;
  createdAt: string;
  approvals: string[];
  approvalRecords?: string[];
  status: string;
  reason: string;
};
export function MilestoneTerms({ version }: { version: MilestoneHistory }) {
  return (
    <div className="space-y-3 mt-4 text-sm">
      <p className="whitespace-pre-wrap break-words">{version.description}</p>
      <p>
        {new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
        }).format(version.amountCents / 100)}{" "}
        · Target deadline: {version.targetDate}
      </p>
      <div>
        <strong>Acceptance criteria</strong>
        <p className="whitespace-pre-wrap break-words">
          {version.acceptanceCriteria}
        </p>
      </div>
      {version.responsibilities && (
        <div>
          <strong>Client responsibilities</strong>
          <p className="whitespace-pre-wrap break-words">
            {version.responsibilities}
          </p>
        </div>
      )}
    </div>
  );
}
export function MilestoneArchive({
  versions,
  selected,
  label,
}: {
  versions: MilestoneHistory[];
  selected?: string;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(
    !!selected && versions.some((v) => v.id === selected),
  );
  return (
    <Dialog.Root open={open} onOpenChange={(next) => {
      setOpen(next);
      if (!next && selected) {
        const url = new URL(window.location.href);
        if (url.searchParams.has("version")) {
          url.searchParams.delete("version");
          router.replace(`${url.pathname}${url.search}`, { scroll: false });
        }
      }
    }}>
      <Dialog.Trigger asChild>
        <Button variant="outline">
          {label ||
            `Archive · ${versions.length} ${versions.length === 1 ? "version" : "versions"}`}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
          <Dialog.Title className="text-xl font-semibold">
            Milestone version history
          </Dialog.Title>
          <Dialog.Description className="muted text-sm mt-3">
            Submitted versions and their approval records are preserved.
            Historical versions cannot be approved.
          </Dialog.Description>
          {versions.map((version) => (
            <section
              key={version.id}
              id={`version-${version.id}`}
              className={`border-t mt-5 pt-4 ${selected === version.id ? "rounded border-teal-600 bg-teal-50 p-3" : ""}`}
            >
              <h3>
                Version {version.number} · {version.status}
              </h3>
              <p className="muted text-xs mt-2">
                {version.author} ·{" "}
                {new Date(version.createdAt).toLocaleString("en-GB", {
                  timeZone: "UTC",
                }) + " UTC"}
              </p>
              <MilestoneTerms version={version} />
              {version.reason && (
                <p className="mt-3 text-sm whitespace-pre-wrap">
                  Reason: {version.reason}
                </p>
              )}
              <p className="mt-3 text-sm">
                Approvals:{" "}
                {(version.approvalRecords || version.approvals).join("; ") ||
                  "None"}
              </p>
            </section>
          ))}
          <Dialog.Close asChild>
            <Button className="mt-5" variant="outline">
              Close archive
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

"use client";

import { Tooltip } from "radix-ui";
import { CircleHelp } from "lucide-react";

export function EvidenceLinkHelp() {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button type="button" aria-label="What is an evidence link?"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:text-teal-800 focus-visible:ring-2 focus-visible:ring-teal-600">
            <CircleHelp size={14} aria-hidden="true" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side="top" sideOffset={6} collisionPadding={16}
            className="z-50 max-w-72 rounded-lg bg-navy p-3 text-xs leading-relaxed text-white shadow-lg">
            Opens a direct link to this message so it can be referenced from
            milestones, contract discussions or AI explanations. It does not
            approve or share anything.
            <Tooltip.Arrow className="fill-navy" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

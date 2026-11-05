"use client";
import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
export function ViewerTime({ start, end }: { start: string; end: string }) {
  const zone = useSyncExternalStore(
    subscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => "UTC",
  );
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: zone,
  };
  return (
    <span>
      {new Date(start).toLocaleString("en-GB", options)} →{" "}
      {new Date(end).toLocaleString("en-GB", options)} ({zone})
    </span>
  );
}

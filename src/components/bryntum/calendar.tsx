"use client";
import { useMemo } from "react";
import { BryntumCalendar } from "@bryntum/calendar-react-enterprise";
import type { CalendarEvent } from "./views";
export default function EngagementCalendar({
  events,
}: {
  events: CalendarEvent[];
}) {
  const rows = useMemo(
    () =>
      events.map((e) => ({
        id: e.id,
        name: `${e.status === "tentative" ? "Tentative: " : e.status === "cancelled" ? "Cancelled: " : ""}${e.name}`,
        startDate: new Date(e.startDate),
        endDate: new Date(e.endDate),
        eventColor:
          e.status === "confirmed"
            ? "teal"
            : e.status === "tentative"
              ? "orange"
              : "gray",
        meetingId: e.meetingId,
      })),
    [events],
  );
  return (
    <BryntumCalendar
      ariaLabel="Engagement meetings"
      height={540}
      readOnly
      mode="month"
      date={rows[0]?.startDate || new Date()}
      events={rows}
      sidebar={false}
      eventTooltipFeature={false}
      eventEditFeature={false}
      dragFeature={false}
      onEventClick={({ eventRecord }) => {
        const meetingId = events.find(
          (e) => e.id === String(eventRecord.id),
        )?.meetingId;
        if (meetingId)
          document
            .getElementById(`meeting-${meetingId}`)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
    />
  );
}

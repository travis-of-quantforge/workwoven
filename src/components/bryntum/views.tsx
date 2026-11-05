"use client";
import dynamic from "next/dynamic";
import { Component, type ReactNode } from "react";
import { registerBryntumLicense } from "./license";
export type TimelineTask = {
  id: string;
  key: string;
  name: string;
  startDate: string;
  endDate: string;
  percentDone: number;
  owner: string;
};
export type TimelineDependency = { from: string; to: string };
export type CalendarEvent = {
  id: string;
  meetingId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "confirmed" | "tentative" | "cancelled";
};
export type GanttData = {
  tasks: TimelineTask[];
  dependencies: TimelineDependency[];
  proposed: boolean;
};
const Gantt = dynamic(
  async () => {
    registerBryntumLicense();
    return import("./gantt");
  },
  {
    ssr: false,
    loading: () => <p role="status">Loading milestone timeline…</p>,
  },
);
const Calendar = dynamic(
  async () => {
    registerBryntumLicense();
    return import("./calendar");
  },
  { ssr: false, loading: () => <p role="status">Loading meeting calendar…</p> },
);
class ChartBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p role="alert" className="notice">
        The interactive view could not load. Your saved records and proposal
        forms remain available below.
      </p>
    ) : (
      this.props.children
    );
  }
}
export function GanttView(props: GanttData) {
  if (!process.env.NEXT_PUBLIC_BRYNTUM_LICENSE_KEY)
    return (
      <p className="notice">
        Gantt view awaits Bryntum licence configuration. Saved schedules work
        below.
      </p>
    );
  return (
    <ChartBoundary>
      <div data-bryntum-view="gantt" className="bryntum-host">
        <Gantt {...props} />
      </div>
    </ChartBoundary>
  );
}
export function MeetingCalendar({ events }: { events: CalendarEvent[] }) {
  if (!process.env.NEXT_PUBLIC_BRYNTUM_LICENSE_KEY)
    return (
      <p className="notice">
        Calendar view awaits Bryntum licence configuration. Meetings work below.
      </p>
    );
  return (
    <ChartBoundary>
      <div data-bryntum-view="calendar" className="bryntum-host">
        <Calendar events={events} />
      </div>
    </ChartBoundary>
  );
}

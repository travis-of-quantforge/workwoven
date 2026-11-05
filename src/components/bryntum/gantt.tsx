"use client";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
const subscribeWidth = (callback: () => void) => {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
};
import { BryntumGantt } from "@bryntum/gantt-react-enterprise";
import type { GanttData } from "./views";
export default function MilestoneGantt({
  tasks,
  dependencies,
  proposed,
}: GanttData) {
  const ganttRef = useRef<BryntumGantt>(null);
  const compact = useSyncExternalStore(
    subscribeWidth,
    () => window.innerWidth < 640,
    () => false,
  );
  const data = useMemo(
    () => ({
      tasks: tasks.map((t) => ({
        id: t.id,
        name: t.name,
        startDate: t.startDate,
        endDate: t.endDate,
        percentDone: t.percentDone,
        manuallyScheduled: true,
        eventColor: proposed ? "orange" : "teal",
        cls: proposed ? "workspace-proposed-task" : "workspace-accepted-task",
      })),
      dependencies: dependencies.map((d, i) => ({
        id: `dependency-${i}`,
        fromTask: d.from,
        toTask: d.to,
        type: 2,
      })),
    }),
    [tasks, dependencies, proposed],
  );
  useEffect(() => {
    let active = true;
    const instance = ganttRef.current?.instance;
    if (instance) {
      void (async () => {
        await instance.project.commitAsync();
        if (active && !instance.isDestroyed)
          await instance.zoomToFit({ leftMargin: 5, rightMargin: 5 });
      })().catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [compact, data]);
  return (
    <BryntumGantt
      ref={ganttRef}
      key={compact ? "compact" : "wide"}
      autoAdjustTimeAxis={false}
      ariaLabel={
        proposed ? "Proposed milestone timeline" : "Accepted milestone timeline"
      }
      startDate={tasks.map((t) => t.startDate).sort()[0]}
      endDate={
        tasks.length
          ? new Date(
              Date.parse(
                tasks
                  .map((t) => t.endDate)
                  .sort()
                  .at(-1)!,
              ) +
                3 * 86400000,
            )
              .toISOString()
              .slice(0, 10)
          : undefined
      }
      height={360}
      readOnly
      rowHeight={44}
      barMargin={10}
      viewPreset="weekAndDayLetter"
      tasks={data.tasks}
      dependencies={data.dependencies}
      columns={[
        {
          type: "name",
          text: "Deliverable",
          width: compact ? 100 : 180,
          htmlEncode: true,
        },
        { type: "percentdone", text: "%", width: 70, hidden: compact },
      ]}
      taskTooltipFeature={false}
      cellEditFeature={false}
      taskEditFeature={false}
      taskMenuFeature={false}
      onTaskClick={({ taskRecord }) => {
        document
          .getElementById(`task-${taskRecord.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
    />
  );
}

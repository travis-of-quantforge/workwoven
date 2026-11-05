"use client";
import { useState } from "react";
import { ActionForm } from "./action-form";
import { Button } from "./ui/button";
import type { Milestone } from "@/lib/milestones";
export function ScheduleEditor({
  id,
  expected,
  base,
  initial,
}: {
  id: string;
  expected: string;
  base: string | null;
  initial: Milestone[];
}) {
  const [tasks, setTasks] = useState(
    initial.map((t) => ({ ...t, amountUsd: (t.amountCents / 100).toFixed(2) })),
  );
  function edit(index: number, key: string, value: string | string[]) {
    setTasks((rows) =>
      rows.map((t, i) => (i === index ? { ...t, [key]: value } : t)),
    );
  }
  return (
    <details className="panel">
      <summary className="font-semibold cursor-pointer">
        Propose a milestone plan
      </summary>
      <p className="muted text-sm my-4">
        Dates, dependencies, deliverables and payment terms become part of the
        next immutable agreement version. Both parties approve it in Agreement.
        The current accepted schedule stays in force until then.
      </p>
      <ActionForm actionName="milestone-plan" className="stack">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="expected" value={expected} />
        <input type="hidden" name="base" value={base || ""} />
        <input type="hidden" name="tasks" value={JSON.stringify(tasks)} />
        {tasks.map((t, i) => (
          <fieldset
            key={t.key}
            className="border border-slate-200 rounded-lg p-4 stack"
          >
            <legend className="px-2 font-semibold">Milestone {i + 1}</legend>
            <label htmlFor={`task-title-${i}`}>Deliverable</label>
            <input
              id={`task-title-${i}`}
              value={t.title}
              maxLength={200}
              required
              onChange={(e) => edit(i, "title", e.target.value)}
            />
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor={`task-owner-${i}`}>Owner</label>
                <select
                  id={`task-owner-${i}`}
                  value={t.owner}
                  onChange={(e) => edit(i, "owner", e.target.value)}
                >
                  <option value="professional">Professional</option>
                  <option value="client">Client</option>
                </select>
              </div>
              <div>
                <label htmlFor={`task-start-${i}`}>Start date</label>
                <input
                  id={`task-start-${i}`}
                  type="date"
                  value={t.startDate}
                  required
                  onChange={(e) => edit(i, "startDate", e.target.value)}
                />
              </div>
              <div>
                <label htmlFor={`task-end-${i}`}>End date</label>
                <input
                  id={`task-end-${i}`}
                  type="date"
                  value={t.endDate}
                  min={t.startDate}
                  required
                  onChange={(e) => edit(i, "endDate", e.target.value)}
                />
              </div>
            </div>
            <label htmlFor={`task-criteria-${i}`}>
              Milestone acceptance criteria
            </label>
            <textarea
              id={`task-criteria-${i}`}
              value={t.acceptanceCriteria}
              maxLength={5000}
              required
              onChange={(e) => edit(i, "acceptanceCriteria", e.target.value)}
            />
            <label htmlFor={`task-terms-${i}`}>Milestone payment terms</label>
            <textarea
              id={`task-terms-${i}`}
              value={t.paymentTerms}
              maxLength={2000}
              required
              onChange={(e) => edit(i, "paymentTerms", e.target.value)}
            />
            <label htmlFor={`task-amount-${i}`}>Allocated amount (USD)</label>
            <input
              id={`task-amount-${i}`}
              value={t.amountUsd}
              inputMode="decimal"
              required
              onChange={(e) => edit(i, "amountUsd", e.target.value)}
            />
            <label htmlFor={`task-deps-${i}`}>
              Predecessors (optional; select all that apply)
            </label>
            <select
              id={`task-deps-${i}`}
              multiple
              value={t.dependencies}
              onChange={(e) =>
                edit(
                  i,
                  "dependencies",
                  Array.from(e.target.selectedOptions, (o) => o.value),
                )
              }
            >
              {tasks
                .filter((o) => o.key !== t.key)
                .map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.title || "Untitled milestone"}
                  </option>
                ))}
            </select>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setTasks((rows) =>
                  rows
                    .filter((_, n) => n !== i)
                    .map((o) => ({
                      ...o,
                      dependencies: o.dependencies.filter((d) => d !== t.key),
                    })),
                )
              }
            >
              Remove milestone {i + 1}
            </Button>
          </fieldset>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={tasks.length >= 30}
          onClick={() =>
            setTasks((rows) => [
              ...rows,
              {
                key: crypto.randomUUID(),
                title: "",
                owner: "professional",
                startDate: "",
                endDate: "",
                acceptanceCriteria: "",
                paymentTerms: "",
                amountCents: 0,
                amountUsd: "0.00",
                dependencies: [],
              },
            ])
          }
        >
          Add milestone
        </Button>
        <label htmlFor="schedule-reason">Reason and schedule impact</label>
        <textarea
          id="schedule-reason"
          name="reason"
          maxLength={3000}
          required
          placeholder="Explain what changes, why, and the impact on delivery dates."
        />
        <Button>Submit schedule for dual approval</Button>
      </ActionForm>
    </details>
  );
}

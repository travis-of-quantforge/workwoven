"use client";
import { useState } from "react";
import { ActionForm } from "./action-form";
import { Button } from "./ui/button";
type Defaults = {
  meeting: string;
  version: string;
  title: string;
  agenda: string;
  local: string;
  zone: string;
  duration: number;
  url: string;
  milestone: string;
};
export function MeetingForm({
  engagements,
  e,
  tasks,
  initial,
  operationKey,
}: {
  engagements: { id: string; title: string }[];
  e?: string;
  tasks: { id: string; title: string }[];
  initial?: Defaults;
  operationKey: string;
}) {
  const [zone, setZone] = useState(initial?.zone || "UTC");
  const suffix = initial?.meeting || "new";
  return (
    <ActionForm actionName="meeting-proposal" className="stack mt-4">
      {e ? (
        <input type="hidden" name="id" value={e} />
      ) : (
        <div>
          <label htmlFor={`meeting-engagement-${suffix}`}>Engagement</label>
          <select id={`meeting-engagement-${suffix}`} name="id" required>
            {engagements.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <input type="hidden" name="meeting" value={initial?.meeting || ""} />
      <input type="hidden" name="expected" value={initial?.version || ""} />
      <div>
        <label htmlFor={`meeting-title-${suffix}`}>Meeting title</label>
        <input
          id={`meeting-title-${suffix}`}
          name="title"
          defaultValue={initial?.title}
          maxLength={200}
          required
        />
      </div>
      <div>
        <label htmlFor={`meeting-start-${suffix}`}>Local date and time</label>
        <input
          id={`meeting-start-${suffix}`}
          name="local"
          type="datetime-local"
          defaultValue={initial?.local}
          required
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`meeting-zone-${suffix}`}>IANA timezone</label>
          <input
            id={`meeting-zone-${suffix}`}
            name="timezone"
            value={zone}
            onChange={(event) => setZone(event.target.value)}
            maxLength={100}
            required
          />
          <Button
            type="button"
            className="mt-2"
            variant="outline"
            onClick={() =>
              setZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
            }
          >
            Use my timezone
          </Button>
        </div>
        <div>
          <label htmlFor={`meeting-duration-${suffix}`}>
            Duration (minutes)
          </label>
          <input
            id={`meeting-duration-${suffix}`}
            name="duration"
            type="number"
            defaultValue={initial?.duration || 30}
            min={5}
            max={480}
            required
          />
        </div>
      </div>
      <div>
        <label htmlFor={`meeting-occurrence-${suffix}`}>
          If the local clock repeats this time
        </label>
        <select
          id={`meeting-occurrence-${suffix}`}
          name="occurrence"
          defaultValue="reject"
        >
          <option value="reject">Ask me to choose an occurrence</option>
          <option value="earlier">Use earlier occurrence</option>
          <option value="later">Use later occurrence</option>
        </select>
      </div>
      <div>
        <label htmlFor={`meeting-agenda-${suffix}`}>Agenda</label>
        <textarea
          id={`meeting-agenda-${suffix}`}
          name="agenda"
          defaultValue={initial?.agenda}
          required
          maxLength={5000}
        />
      </div>
      <div>
        <label htmlFor={`meeting-url-${suffix}`}>
          Meeting URL (HTTPS, optional)
        </label>
        <input
          id={`meeting-url-${suffix}`}
          name="url"
          type="url"
          defaultValue={initial?.url}
          maxLength={2000}
        />
      </div>
      {!!e && (
        <div>
          <label htmlFor={`meeting-milestone-${suffix}`}>
            Related accepted milestone (optional)
          </label>
          <select
            id={`meeting-milestone-${suffix}`}
            name="milestone"
            defaultValue={initial?.milestone || ""}
          >
            <option value="">None</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="muted text-xs">
        Participants: both engagement parties. Your proposal records your
        acceptance; the counterparty must accept this exact version. Times are
        stored in UTC. No email or external calendar invitation is sent.
      </p>
      <input type="hidden" name="operationKey" value={operationKey} />
      <Button>
        {initial ? "Suggest this revised time" : "Propose meeting"}
      </Button>
    </ActionForm>
  );
}

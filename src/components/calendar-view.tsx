import { MeetingCalendar, type CalendarEvent } from "./bryntum/views";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { MeetingForm } from "./meeting-form";
import { ViewerTime } from "./viewer-time";
import { ActionForm } from "./action-form";
import { Button } from "./ui/button";
import { localDateTime, overlaps } from "@/lib/calendar";
export async function CalendarView({
  db,
  userId,
  e,
}: {
  db: SupabaseClient;
  userId: string;
  e?: string;
}) {
  const [meetingRows, engagements, tasks] = await Promise.all([
    db
      .from("meetings")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300),
    db.from("engagements").select("id,title,status,accepted_version_id"),
    db.from("milestone_tasks").select("id,title,version_id,engagement_id"),
  ]);
  if (meetingRows.error || engagements.error)
    return (
      <p className="notice">
        Calendar data could not be loaded. Refresh or check migrations.
      </p>
    );
  const meetings = meetingRows.data || [],
    visible = meetings.filter((m) => !e || m.engagement_id === e);
  const ids = meetings.map((m) => m.id);
  const versions = ids.length
    ? await db
        .from("meeting_versions")
        .select("*")
        .in("meeting_id", ids)
        .order("number", { ascending: false })
    : { data: [] };
  const vIds = (versions.data || []).map((v) => v.id);
  const [responses, notes] = await Promise.all([
    vIds.length
      ? db.from("meeting_responses").select("*").in("version_id", vIds)
      : { data: [] },
    vIds.length
      ? db
          .from("meeting_notes")
          .select("*")
          .in("version_id", vIds)
          .order("created_at")
      : { data: [] },
  ]);
  const currentEngagement = engagements.data?.find((g) => g.id === e);
  const selectable = (engagements.data || []).filter((g) =>
    ["discussion", "active"].includes(g.status),
  );
  const currentTasks = (tasks.data || []).filter(
    (t) => t.version_id === currentEngagement?.accepted_version_id,
  );
  const known = meetings
    .filter((m) => m.status === "open")
    .flatMap((m) => {
      const p = versions.data?.find((v) => v.id === m.accepted_version_id);
      return p ? [{ meeting: m, proposal: p }] : [];
    });
  return (
    <div className="stack">
      <section className="panel">
        <p className="eyebrow">{e ? "Engagement calendar" : "Your calendar"}</p>
        <h2 className="mt-3">Meetings and review calls</h2>
        <p className="muted mt-3">
          {e
            ? "Only this engagement’s events appear below."
            : "Meetings across your authorised engagements."}{" "}
          Times display in your browser’s timezone. Both parties must accept the
          same proposal.
        </p>
        <p className="muted text-xs mt-4">
          Bryntum Calendar · evaluation licence. Confirmed and tentative times
          are separate. Propose changes below; dragging cannot alter a
          commitment.
        </p>
        {e && (
          <Link className="underline text-sm block mt-4" href="/calendar">
            View all your engagement meetings
          </Link>
        )}
      </section>
      <MeetingCalendar
        key={JSON.stringify(visible.map((m) => [m.id, m.sequence]))}
        events={visible.flatMap((m): CalendarEvent[] => {
          const history = (versions.data || []).filter(
              (v) => v.meeting_id === m.id,
            ),
            latest = history[0];
          if (!latest) return [];
          const confirmed = history.find((v) => v.id === m.accepted_version_id);
          return [
            ...(confirmed && confirmed.id !== latest.id ? [confirmed] : []),
            latest,
          ].map((v) => ({
            id: v.id,
            meetingId: m.id,
            name: v.title,
            startDate: v.starts_at,
            endDate: v.ends_at,
            status:
              m.status === "cancelled" ||
              responses.data?.some(
                (r) => r.version_id === v.id && r.response === "declined",
              )
                ? "cancelled"
                : v.id === m.accepted_version_id
                  ? "confirmed"
                  : "tentative",
          }));
        })}
      />
      {!visible.length && <p className="panel">No meetings scheduled yet.</p>}
      {visible.map((m) => {
        const history = (versions.data || []).filter(
            (v) => v.meeting_id === m.id,
          ),
          latest = history[0];
        if (!latest) return null;
        const confirmed = history.find((v) => v.id === m.accepted_version_id);
        const active = [
          ...(confirmed && confirmed.id !== latest.id ? [confirmed] : []),
          latest,
        ];
        const open = m.status === "open",
          g = engagements.data?.find((g) => g.id === m.engagement_id);
        return (
          <section key={m.id} id={`meeting-${m.id}`} className="panel">
            <h3>{latest.title}</h3>
            {!e && (
              <Link
                className="underline muted text-xs"
                href={`/workspace/${m.engagement_id}?tab=calendar`}
              >
                {g?.title}
              </Link>
            )}
            {!open && (
              <p className="notice mt-3">
                Cancelled · download the updated event to update your calendar.
              </p>
            )}
            {active.map((v) => {
              const replies = (responses.data || []).filter(
                  (r) => r.version_id === v.id,
                ),
                own = replies.find((r) => r.user_id === userId);
              const declined = replies.some((r) => r.response === "declined"),
                agreed = m.accepted_version_id === v.id;
              const clashes = known.filter(
                (other) =>
                  other.meeting.id !== m.id &&
                  overlaps(
                    { start: v.starts_at, end: v.ends_at },
                    {
                      start: other.proposal.starts_at,
                      end: other.proposal.ends_at,
                    },
                  ),
              );
              return (
                <div key={v.id} className="mt-4 pt-4 border-t border-slate-200">
                  <span className="badge">
                    Version {v.number} ·{" "}
                    {!open
                      ? "cancelled"
                      : agreed
                        ? "confirmed"
                        : declined
                          ? "declined"
                          : "tentative"}
                  </span>
                  <p className="mt-3 font-semibold">
                    <ViewerTime start={v.starts_at} end={v.ends_at} />
                  </p>
                  <p className="muted text-xs mt-2">
                    Proposed timezone: {v.timezone} · Participants: both
                    engagement parties
                  </p>
                  {confirmed?.id === v.id && v.id !== latest.id && open && (
                    <p className="notice text-sm mt-3">
                      This confirmed time stays in place while the revised
                      proposal is considered.
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words mt-3">
                    {v.agenda}
                  </p>
                  {v.meeting_url && (
                    <a
                      className="underline text-sm block mt-3"
                      href={v.meeting_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open meeting URL
                    </a>
                  )}
                  {v.milestone_id && (
                    <Link
                      className="underline text-sm block mt-3"
                      href={`/workspace/${m.engagement_id}?tab=milestones#task-${v.milestone_id}`}
                    >
                      Related agreement milestone
                    </Link>
                  )}
                  {clashes.length > 0 && (
                    <p className="notice text-sm mt-3">
                      Overlaps your confirmed meeting(s):{" "}
                      {clashes.map((c) => c.proposal.title).join(", ")}. This
                      warning describes your known schedule only.
                    </p>
                  )}
                  <ul className="muted text-xs space-y-2 mt-3">
                    {replies.map((r) => (
                      <li key={r.user_id}>
                        {r.user_id === userId ? "You" : "Counterparty"}:{" "}
                        {r.response}
                        {r.reason ? ` · ${r.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                  <a
                    className="underline text-sm inline-block mt-4"
                    href={`/api/meetings/${m.id}/calendar?version=${v.id}`}
                  >
                    Download {agreed ? "confirmed" : "proposed"} event (.ics)
                  </a>
                  {v.id === latest.id &&
                    !own &&
                    open &&
                    new Date(v.ends_at) > new Date() && (
                      <ActionForm
                        actionName="meeting-response"
                        className="stack mt-4"
                      >
                        <input
                          type="hidden"
                          name="id"
                          value={m.engagement_id}
                        />
                        <input type="hidden" name="version" value={v.id} />
                        <label htmlFor={`meeting-reason-${v.id}`}>
                          Response note (required when declining)
                        </label>
                        <textarea
                          id={`meeting-reason-${v.id}`}
                          name="reason"
                          maxLength={3000}
                        />
                        <div className="flex flex-wrap gap-3">
                          <Button name="answer" value="accepted">
                            Accept meeting time
                          </Button>
                          <Button
                            name="answer"
                            value="declined"
                            variant="outline"
                          >
                            Decline meeting time
                          </Button>
                        </div>
                      </ActionForm>
                    )}
                </div>
              );
            })}
            {open && ["discussion", "active"].includes(g?.status || "") && (
              <details className="mt-5 border-t border-slate-200 pt-4">
                <summary className="font-semibold cursor-pointer">
                  Suggest another time
                </summary>
                <MeetingForm
                  key={latest.id}
                  operationKey={randomUUID()}
                  e={m.engagement_id}
                  engagements={[]}
                  tasks={(tasks.data || []).filter(
                    (t) =>
                      t.engagement_id === m.engagement_id &&
                      t.version_id === g?.accepted_version_id,
                  )}
                  initial={{
                    meeting: m.id,
                    version: latest.id,
                    title: latest.title,
                    agenda: latest.agenda,
                    local: localDateTime(latest.starts_at, latest.timezone),
                    zone: latest.timezone,
                    duration:
                      (Date.parse(latest.ends_at) -
                        Date.parse(latest.starts_at)) /
                      60000,
                    url: latest.meeting_url || "",
                    milestone: latest.milestone_id || "",
                  }}
                />
              </details>
            )}
            <details className="mt-5 border-t border-slate-200 pt-4">
              <summary className="font-semibold cursor-pointer">
                Meeting notes and follow-up actions
              </summary>
              <p className="muted text-xs mt-3">
                Shared with both parties. Notes cannot change accepted scope or
                authorise payment.
              </p>
              {notes.data
                ?.filter((n) => history.some((v) => v.id === n.version_id))
                .map((n) => (
                  <div
                    key={n.id}
                    className="mt-4 border-t border-slate-100 pt-3"
                  >
                    <p className="muted text-xs">
                      Version{" "}
                      {history.find((v) => v.id === n.version_id)?.number} ·{" "}
                      {new Date(n.created_at).toLocaleString("en-GB", {
                        timeZone: "UTC",
                      })}{" "}
                      UTC
                    </p>
                    <p className="whitespace-pre-wrap break-words mt-2">
                      {n.body}
                    </p>
                  </div>
                ))}
              <ActionForm actionName="meeting-note" className="stack mt-4">
                <input type="hidden" name="id" value={m.engagement_id} />
                <input
                  type="hidden"
                  name="version"
                  value={confirmed?.id || latest.id}
                />
                <input type="hidden" name="operationKey" value={randomUUID()} />
                <label htmlFor={`notes-${m.id}`}>Shared meeting notes</label>
                <textarea
                  id={`notes-${m.id}`}
                  name="body"
                  maxLength={10000}
                  required
                />
                <Button variant="outline">Save notes</Button>
              </ActionForm>
            </details>
            {history.length > active.length && (
              <details className="mt-4">
                <summary>Earlier proposal history</summary>
                {history
                  .filter((v) => !active.some((a) => a.id === v.id))
                  .map((v) => (
                    <p className="muted text-sm mt-3" key={v.id}>
                      Version {v.number}:{" "}
                      <ViewerTime start={v.starts_at} end={v.ends_at} />
                    </p>
                  ))}
              </details>
            )}
            {open && (
              <details className="mt-5">
                <summary>Cancel this meeting</summary>
                <ActionForm actionName="meeting-cancel" className="stack mt-4">
                  <input type="hidden" name="id" value={m.engagement_id} />
                  <input type="hidden" name="meeting" value={m.id} />
                  <input type="hidden" name="expected" value={latest.id} />
                  <label htmlFor={`cancel-${m.id}`}>Cancellation reason</label>
                  <textarea
                    id={`cancel-${m.id}`}
                    name="reason"
                    maxLength={3000}
                    required
                  />
                  <Button variant="outline">
                    Confirm meeting cancellation
                  </Button>
                </ActionForm>
              </details>
            )}
          </section>
        );
      })}
      {selectable.length > 0 && (!e || selectable.some((g) => g.id === e)) && (
        <details className="panel">
          <summary className="font-semibold cursor-pointer">
            Propose a review meeting
          </summary>
          <MeetingForm
            operationKey={randomUUID()}
            e={e}
            engagements={selectable}
            tasks={currentTasks}
          />
        </details>
      )}
      <p className="muted text-xs">
        Clash warnings cover confirmed meetings known to this application;
        external Google/Outlook availability is not connected. Showing up to 300
        recent meetings. Calendar downloads contain event details only, without
        private discussion or account email addresses. Importing an .ics file
        does not automatically subscribe to future updates; download a new
        revision after changes.
      </p>
    </div>
  );
}

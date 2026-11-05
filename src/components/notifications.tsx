import Link from "next/link";
import { ActionForm } from "./action-form";
import { Button } from "./ui/button";
type Notice = {
  id: string;
  engagement_id: string;
  kind: string;
  record_id: string;
  seen_at: string | null;
  created_at: string;
};
export function Notifications({ items }: { items: Notice[] }) {
  return (
    <details className="panel mb-6">
      <summary className="cursor-pointer font-semibold">
        Notifications · {items.filter((n) => !n.seen_at).length} unread
      </summary>
      {!items.length && <p className="muted mt-4">No notifications yet.</p>}
      {items.map((n) => {
        const discussion = ["message", "reply", "mention"].includes(n.kind);
        return (
          <div
            key={n.id}
            className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 mt-4 pt-4"
          >
            <div>
              <Link
                className="underline text-sm"
                href={`/workspace/${n.engagement_id}?tab=${discussion ? "discussion" : n.kind === "invitation_accepted" ? "discussion" : n.kind === "concern" ? "concerns" : n.kind === "payment_request" ? "payments" : n.kind === "review_published" ? "reputation" : n.kind.startsWith("delivery") ? "milestones" : n.kind.startsWith("meeting") ? "calendar" : "agreement"}${discussion ? "#message-" + n.record_id : n.kind === "concern" ? "#concern-" + n.record_id : ""}`}
              >
                {n.kind.replaceAll("_", " ")}
              </Link>
              <p className="muted text-xs">
                {new Date(n.created_at).toLocaleString("en-GB", {
                  timeZone: "UTC",
                })}{" "}
                UTC
              </p>
            </div>
            {!n.seen_at && (
              <ActionForm actionName="seen">
                <input type="hidden" name="id" value={n.engagement_id} />
                <input type="hidden" name="notification" value={n.id} />
                <Button variant="outline">Mark seen</Button>
              </ActionForm>
            )}
          </div>
        );
      })}
    </details>
  );
}

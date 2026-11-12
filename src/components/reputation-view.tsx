import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { ActionForm } from "./action-form";
import { Button } from "./ui/button";
import { dimensionLabels } from "@/lib/reputation";
export async function ReputationView({
  db,
  id,
  role,
  userId,
  accepted,
  status,
  isDemo,
}: {
  db: SupabaseClient;
  id: string;
  role: string;
  userId: string;
  accepted: string | null;
  status: string;
  isDemo: boolean;
}) {
  const [window, reviews, completion, portfolio] = await Promise.all([
    db.from("review_windows").select("*").eq("engagement_id", id).maybeSingle(),
    db.from("reviews").select("*").eq("engagement_id", id).order("created_at"),
    db.from("completion_approvals").select("*").eq("engagement_id", id),
    db
      .from("portfolio_items")
      .select("*")
      .eq("engagement_id", id)
      .order("created_at"),
  ]);
  if (reviews.error || portfolio.error || window.error)
    return (
      <p className="notice">
        Reputation data could not be loaded. Refresh or check database
        migrations.
      </p>
    );
  const own = reviews.data?.find((r) => r.author_id === userId),
    w = window.data;
  const published =
    !!w && (!!w.published_at || new Date(w.closes_at) <= new Date());
  const currentApprovals =
    completion.data?.filter((a) => a.version_id === accepted) || [];
  const reviewIds = (reviews.data || []).map((r) => r.id);
  const replies = reviewIds.length
    ? await db.from("review_replies").select("*").in("review_id", reviewIds)
    : { data: [] };
  const dimensions =
    role === "professional"
      ? ["communication", "clarity", "collaboration", "honouringAgreements"]
      : ["communication", "delivery", "collaboration", "honouringAgreements"];
  const isOpen = ["discussion", "active"].includes(status);
  return (
    <div className="stack">
      {isOpen && (
        <section className="panel">
          <p className="eyebrow">Engagement outcome</p>
          <h2 className="mt-3">End engagement</h2>
          <p className="muted mt-3">
            Status: {status}. Closing an engagement does not settle a concern,
            execute a refund or erase accepted obligations. Completion requires
            both parties’ confirmation of the current accepted agreement.
          </p>
          {isDemo && (
            <p className="notice mt-4">
              Demo engagement: feedback and activity are excluded from real public
              reputation.
            </p>
          )}
          <p className="text-sm my-4">
            Completion confirmations:{" "}
            {currentApprovals.map((a) => a.role).join(", ") || "None"}
          </p>
          {!accepted && (
            <p className="muted text-sm mb-4">
              Completion is available after both parties accept a milestone.
              To end this discussion now, enter a reason and choose Cancel engagement.
            </p>
          )}
          <ActionForm actionName="engagement-outcome" className="stack">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="expected" value={accepted || ""} />
            <label htmlFor="outcome-reason">Outcome reason</label>
            <textarea
              id="outcome-reason"
              name="reason"
              maxLength={3000}
              required
            />
            <div className="flex flex-wrap gap-3">
              <Button
                name="outcome"
                value="completed"
                disabled={
                  !accepted ||
                  currentApprovals.some((a) => a.user_id === userId)
                }
              >
                Confirm completion as {role}
              </Button>
              <Button name="outcome" value="cancelled" variant="outline">
                Cancel engagement
              </Button>
            </div>
          </ActionForm>
        </section>
      )}
      {!isOpen && (
        <>
      <section className="panel">
        <h2>Two-way feedback</h2>
        {isDemo && (
          <p className="notice mt-4">
            Demo engagement: feedback and activity are excluded from real public reputation.
          </p>
        )}
        <p className="muted my-3">
          This engagement has ended. Existing feedback and portfolio records are read-only.
          Previously submitted feedback keeps its original publication rules.
        </p>
        <Link className="underline text-sm" href="/profile">
          Manage your public profile
        </Link>
        {!w && (
          <p className="notice mt-4">
            No feedback was recorded for this engagement.
          </p>
        )}
        {w && (
          <p className="notice mt-4">
            {published
              ? "Feedback published to participants. Public display also requires the reviewed party’s public profile and non-demo activity."
              : `Previously submitted feedback publishes by ${new Date(w.closes_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC. Unpublished feedback is visible only to its author.`}
          </p>
        )}
        {w && !own && !published && (
          <ActionForm actionName="review" className="stack mt-5">
            <input type="hidden" name="id" value={id} />
            <label htmlFor="feedback-body">
              Written feedback about the{" "}
              {role === "client" ? "professional" : "client"}
            </label>
            <textarea
              id="feedback-body"
              name="body"
              minLength={20}
              maxLength={5000}
              required
              placeholder="Describe your experience with specific, fair context. Do not disclose confidential details."
            />
            <div className="grid sm:grid-cols-2 gap-4">
              {dimensions.map((key) => (
                <div key={key}>
                  <label htmlFor={`rating-${key}`}>
                    {dimensionLabels[key]} (1–5)
                  </label>
                  <select
                    id={`rating-${key}`}
                    name={key}
                    required
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Choose a rating
                    </option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <p className="muted text-xs">Feedback is frozen when you submit it.</p>
            <Button>Submit private feedback</Button>
          </ActionForm>
        )}
        {own && !published && (
          <p className="font-semibold mt-4">
            Your feedback is submitted and frozen. The counterparty cannot read
            it yet.
          </p>
        )}
        {(reviews.data || []).map((r) => (
          <article key={r.id} className="border-t border-slate-200 mt-5 pt-4">
            <h3>
              {r.author_id === userId
                ? "Your submitted feedback"
                : `Feedback from the ${r.author_role}`}
            </h3>
            <p className="whitespace-pre-wrap break-words mt-3">{r.body}</p>
            <ul className="flex flex-wrap gap-3 muted text-xs mt-3">
              {Object.entries(r.dimensions as Record<string, number>).map(
                ([key, n]) => (
                  <li key={key}>
                    {dimensionLabels[key]}: {n}/5
                  </li>
                ),
              )}
            </ul>
            {replies.data
              ?.filter((reply) => reply.review_id === r.id)
              .map((reply) => (
                <p
                  key={reply.review_id}
                  className="notice whitespace-pre-wrap break-words text-sm mt-4"
                >
                  <strong>Reviewed party’s reply:</strong> {reply.body}
                </p>
              ))}
            {published &&
              r.target_id === userId &&
              !replies.data?.some((reply) => reply.review_id === r.id) && (
                <ActionForm actionName="review-reply" className="stack mt-4">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="review" value={r.id} />
                  <label htmlFor={`reply-${r.id}`}>Your public reply</label>
                  <textarea
                    id={`reply-${r.id}`}
                    name="body"
                    maxLength={3000}
                    required
                  />
                  <Button variant="outline">Submit frozen reply</Button>
                </ActionForm>
              )}
            {published && (
              <details className="mt-4">
                <summary className="muted text-xs">
                  Report for moderation
                </summary>
                <ActionForm actionName="review-report" className="stack mt-3">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="review" value={r.id} />
                  <label htmlFor={`report-${r.id}`}>
                    Policy issue (criticism alone is not grounds for removal)
                  </label>
                  <textarea
                    id={`report-${r.id}`}
                    name="reason"
                    minLength={10}
                    maxLength={3000}
                    required
                  />
                  <Button variant="outline">Report feedback</Button>
                </ActionForm>
              </details>
            )}
          </article>
        ))}
      </section>
      <section className="panel">
        <h2>Portfolio permission</h2>
        <p className="muted mt-3">
          The professional proposes exact public text and a link. The client
          must permit that specific example, and the professional must enable
          publication. Permission can be revoked. Private attachments are never
          published automatically.
        </p>
        {portfolio.data?.map((p) => (
          <article key={p.id} className="border-t mt-5 pt-4">
            <h3>{p.title}</h3>
            <p className="whitespace-pre-wrap break-words mt-3">
              {p.description}
            </p>
            <a
              className="underline text-sm break-all"
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {p.url}
            </a>
            <p className="muted text-xs my-3">
              Client permission:{" "}
              {p.client_approved ? "approved" : "not granted"} · Professional
              publication: {p.published ? "enabled" : "disabled"}
            </p>
            <ActionForm
              actionName={
                role === "client"
                  ? "portfolio-permission"
                  : "portfolio-visibility"
              }
            >
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="portfolio" value={p.id} />
              <Button
                variant="outline"
                name="allow"
                value={
                  role === "client"
                    ? p.client_approved
                      ? "no"
                      : "yes"
                    : p.published
                      ? "no"
                      : "yes"
                }
              >
                {role === "client"
                  ? p.client_approved
                    ? "Revoke client permission"
                    : "Approve this public example"
                  : p.published
                    ? "Disable publication"
                    : "Enable publication after client permission"}
              </Button>
            </ActionForm>
          </article>
        ))}
        {role === "professional" && accepted && (
          <details className="mt-5 border-t pt-4">
            <summary className="font-semibold cursor-pointer">
              Request portfolio permission
            </summary>
            <ActionForm actionName="portfolio-proposal" className="stack mt-4">
              <input type="hidden" name="id" value={id} />
              <label htmlFor="portfolio-title">Public example title</label>
              <input
                id="portfolio-title"
                name="title"
                maxLength={160}
                required
              />
              <label htmlFor="portfolio-description">
                Exact public description
              </label>
              <textarea
                id="portfolio-description"
                name="body"
                maxLength={3000}
                required
              />
              <label htmlFor="portfolio-url">Public example URL (HTTPS)</label>
              <input
                id="portfolio-url"
                name="url"
                type="url"
                maxLength={2000}
                required
              />
              <Button>Send this example for client permission</Button>
            </ActionForm>
          </details>
        )}
      </section>
        </>
      )}
    </div>
  );
}

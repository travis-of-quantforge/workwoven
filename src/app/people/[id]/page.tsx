import { notFound } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { configured, database } from "@/lib/supabase/server";
import { dimensionLabels, publicProfileSchema } from "@/lib/reputation";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
export const dynamic = "force-dynamic";
export default async function PublicProfile({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success || !configured()) notFound();
  const db = await database();
  const { data, error } = await db.rpc("public_profile", { p: id.data });
  const parsed = publicProfileSchema.safeParse(data);
  if (error || !parsed.success) notFound();
  const p = parsed.data;
  const user = (await db.auth.getUser()).data.user;
  return (
    <main className="max-w-4xl mx-auto px-5 py-8">
      <Link className="underline text-sm" href="/">
        Workspace
      </Link>
      <section className="panel my-6">
        <p className="eyebrow">Public profile</p>
        <h1 className="mt-3">{p.displayName}</h1>
        {p.company && <p className="text-lg mt-3">{p.company}</p>}
        <p className="whitespace-pre-wrap break-words muted mt-4">{p.bio}</p>
        <ul className="flex flex-wrap gap-2 mt-5">
          {p.skills.map((s, i) => (
            <li className="badge" key={i}>
              {s}
            </li>
          ))}
        </ul>
        <p className="text-sm mt-5">
          {p.completionCount} mutually confirmed completed engagement
          {p.completionCount === 1 ? "" : "s"}
        </p>
        <p className="muted text-xs mt-2">
          Recorded platform activity does not establish work quality, identity
          verification or a fraud-free history. Written feedback below reflects
          participants’ opinions.
        </p>
        {p.badges.map((b, i) => (
          <details key={i} className="border-t mt-4 pt-4">
            <summary>{b.title}</summary>
            <p className="muted text-xs mt-3">{b.criteria}</p>
          </details>
        ))}
      </section>
      {(["professional", "client"] as const).map((role) => (
        <section key={role} className="panel mb-6">
          <h2>
            Feedback as a {role} · {p.reviewCounts[role]}
          </h2>
          <p className="muted text-xs my-3">
            Written by {role === "client" ? "professionals" : "clients"} from
            engagements with a formally accepted agreement. Feedback publishes
            after both submit or the 14-day window closes.
          </p>
          {!p.reviewCounts[role] && (
            <p>No published feedback in this role yet.</p>
          )}
          {p.reviews
            .filter((r) => r.reviewedRole === role)
            .map((r) => (
              <article
                id={`review-${r.id}`}
                key={r.id}
                className="border-t border-slate-200 mt-5 pt-5"
              >
                <p className="muted text-xs">
                  {r.authorProfileId ? (
                    <Link
                      className="underline"
                      href={`/people/${r.authorProfileId}`}
                    >
                      {r.authorName}
                    </Link>
                  ) : (
                    r.authorName
                  )}{" "}
                  · {r.authorRole} · {r.context} engagement · accepted agreement
                </p>
                <p className="whitespace-pre-wrap break-words mt-4">{r.body}</p>
                <ul className="flex flex-wrap gap-3 text-xs muted mt-4">
                  {Object.entries(r.dimensions).map(([key, score]) => (
                    <li key={key}>
                      {dimensionLabels[key] || key}: {score}/5
                    </li>
                  ))}
                </ul>
                {r.reply && (
                  <div className="notice mt-4 text-sm">
                    <strong>Profile owner’s reply:</strong>
                    <p className="whitespace-pre-wrap break-words mt-2">
                      {r.reply}
                    </p>
                  </div>
                )}
                {user && (
                  <details className="mt-4">
                    <summary className="muted text-xs cursor-pointer">
                      Report a policy issue
                    </summary>
                    <ActionForm
                      actionName="review-report"
                      className="stack mt-3"
                    >
                      <input type="hidden" name="review" value={r.id} />
                      <input type="hidden" name="profile" value={p.id} />
                      <label htmlFor={`report-${r.id}`}>Report reason</label>
                      <textarea
                        id={`report-${r.id}`}
                        name="reason"
                        minLength={10}
                        maxLength={3000}
                        required
                      />
                      <Button variant="outline">
                        Submit report for moderation
                      </Button>
                    </ActionForm>
                  </details>
                )}
              </article>
            ))}
        </section>
      ))}
      {p.portfolio.length > 0 && (
        <section className="panel">
          <h2>Client-approved portfolio</h2>
          {p.portfolio.map((item, i) => (
            <article key={i} className="mt-4 border-t pt-4">
              <h3>{item.title}</h3>
              <p className="whitespace-pre-wrap break-words my-3">
                {item.description}
              </p>
              <a
                className="underline text-sm"
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                View portfolio example
              </a>
            </article>
          ))}
        </section>
      )}
      <p className="muted text-xs mt-6">
        Showing up to 50 recent published reviews. Demo activity is excluded
        from reviews, completion facts, badges and portfolio entries. Reviews
        can be reported for moderation; valid criticism cannot be removed
        unilaterally by the profile owner.
      </p>
    </main>
  );
}

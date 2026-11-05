import { usd } from "@/lib/domain";
import { milestonePlanSchema, changeSchema } from "@/lib/milestones";
const labels: Record<string, string> = {
  deliverables: "Deliverables",
  exclusions: "Exclusions",
  assumptions: "Assumptions",
  responsibilities: "Client responsibilities",
  acceptanceCriteria: "Acceptance criteria",
  priceCents: "Price",
  currency: "Currency",
  paymentTerms: "Payment terms",
  schedule: "Schedule",
  milestones: "Milestone plan",
  change: "Change explanation",
};
function valueText(key: string, value: unknown) {
  if (key === "priceCents") return usd(Number(value));
  if (key === "milestones") {
    const p = milestonePlanSchema.safeParse(value);
    return p.success
      ? p.data
          .map(
            (t) =>
              `${t.title} · ${t.startDate} → ${t.endDate} · ${t.owner} · ${usd(t.amountCents)}\nCriteria: ${t.acceptanceCriteria}\nPayment: ${t.paymentTerms}\nPredecessors: ${t.dependencies.map((d) => p.data.find((x) => x.key === d)?.title || d).join(", ") || "None"}`,
          )
          .join("\n\n")
      : "Plan unavailable";
  }
  if (key === "change") {
    const c = changeSchema.safeParse(value);
    return c.success
      ? `Reason: ${c.data.reason}\nAffected scope: ${c.data.affectedReferences}\nCost impact: ${c.data.costImpact}\nSchedule impact: ${c.data.scheduleImpact}`
      : "";
  }
  return String(value ?? "—");
}
export function ScopeDetails({
  content,
}: {
  content: Record<string, unknown>;
}) {
  return (
    <dl className="grid gap-5 md:grid-cols-2">
      {Object.entries(content).map(([k, v]) => (
        <div key={k}>
          <dt className="eyebrow">{labels[k] || k}</dt>
          <dd className="whitespace-pre-wrap break-words mt-2">
            {valueText(k, v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function ScopeComparison({
  accepted,
  proposed,
}: {
  accepted: Record<string, unknown>;
  proposed: Record<string, unknown>;
}) {
  const changed = Object.keys(labels).filter(
    (k) =>
      k !== "change" &&
      JSON.stringify(accepted[k]) !== JSON.stringify(proposed[k]),
  );
  return (
    <details className="border-t border-slate-200 my-5 pt-4">
      <summary className="font-semibold cursor-pointer">
        Compare with accepted agreement · {changed.length} changed fields
      </summary>
      <div className="mt-4 space-y-5">
        {changed.map((k) => (
          <section key={k}>
            <h3>{labels[k]}</h3>
            <div className="grid md:grid-cols-2 gap-4 mt-3">
              <div className="bg-slate-50 p-4 rounded-lg">
                <p className="eyebrow">Accepted</p>
                <p className="whitespace-pre-wrap break-words text-sm mt-2">
                  {valueText(k, accepted[k])}
                </p>
              </div>
              <div className="bg-teal-50 p-4 rounded-lg">
                <p className="eyebrow">Proposed</p>
                <p className="whitespace-pre-wrap break-words text-sm mt-2">
                  {valueText(k, proposed[k])}
                </p>
              </div>
            </div>
          </section>
        ))}
      </div>
    </details>
  );
}

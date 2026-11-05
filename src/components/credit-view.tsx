import { randomUUID } from "node:crypto";
import { ActionForm } from "./action-form";
import { Button } from "./ui/button";
import { formatNano } from "@/lib/ai/pricing";
import { usd } from "@/lib/domain";
type Summary = {
  accountId: string;
  availableNano: string;
  reservedNano: string;
  spentNano: string;
  promotionalAvailableNano: string;
  purchasedAvailableNano: string;
};
type Ledger = {
  id: string;
  kind: string;
  source: string;
  amount_nano: number;
  created_at: string;
};
type Usage = {
  id: string;
  status: string;
  charge_nano: number;
  provider_nano: number | null;
  usage_uncertain: boolean;
  created_at: string;
};
type Purchase = {
  id: string;
  purchaser_id: string;
  amount_cents: number;
  status: string;
};
export function CreditView({
  id,
  visibility,
  summary,
  ledger,
  usage,
  purchases,
  userId,
  topupAmounts,
}: {
  id: string;
  visibility: string;
  summary: Summary;
  ledger: Ledger[];
  usage: Usage[];
  purchases: Purchase[];
  userId: string;
  topupAmounts: number[];
}) {
  return (
    <div className="stack">
      <div className="panel">
        <p className="eyebrow">
          {visibility === "shared"
            ? "Shared project credits"
            : `Your private ${visibility} credits`}
        </p>
        <h2 className="mt-3">AI usage credits</h2>
        <p className="muted my-3">
          Prepaid application usage, separate from professional payments.{" "}
          {visibility === "shared"
            ? "Shared spending is visible to both parties."
            : "Your balance and usage are visible only to your party."}
        </p>
        <dl className="grid gap-6 sm:grid-cols-3">
          {[
            ["Available", summary.availableNano],
            ["Reserved", summary.reservedNano],
            ["Spent", summary.spentNano],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="eyebrow">{label}</dt>
              <dd className="text-xl font-semibold mt-2">
                {formatNano(value)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="muted text-xs mt-5">
          Available promotional credits:{" "}
          {formatNano(summary.promotionalAvailableNano)} · Available purchased
          credits: {formatNano(summary.purchasedAvailableNano)}
        </p>
        {BigInt(summary.availableNano) < 1000000000n && (
          <p className="notice text-sm mt-4">
            Credits are low. Messages, files, approvals and existing records
            remain usable.
          </p>
        )}
        <div className="border-t border-slate-200 pt-5 mt-6">
          <h3>Credit allocation</h3>
          <p className="notice text-sm my-4">
            During the hackathon, an authorised admin can allocate promotional
            demo credits. PayPal credit checkout is not implemented; these
            disabled purchase amounts do not create a charge or credits.
          </p>
          <div className="flex flex-wrap gap-3">
            {topupAmounts.map((c) => (
              <Button key={c} disabled>
                {usd(c)}
              </Button>
            ))}
          </div>
          <p className="muted text-xs mt-4">
            The signup grant funds only the shared agent. Private use needs a
            separate admin allocation during the hackathon. Promotional
            credits are non-transferable and have no cash value.
          </p>
        </div>
      </div>
      <div className="panel overflow-x-auto">
        <h2>Recent usage</h2>
        <p className="muted my-3 text-xs">
          Original charge = metered provider cost × 2. No per-operation cent
          rounding; failed-request costs may be absorbed by the platform.
          Corrections and refunds appear in the ledger.
        </p>
        {!usage.length ? (
          <p>No AI usage recorded in this balance.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                <th className="p-2">Time (UTC)</th>
                <th className="p-2">Status</th>
                <th className="p-2">Provider cost</th>
                <th className="p-2">Original charge</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="p-2">
                    {new Date(u.created_at).toLocaleString("en-GB", {
                      timeZone: "UTC",
                    })}
                  </td>
                  <td className="p-2">{u.status.replaceAll("_", " ")}</td>
                  <td className="p-2">
                    {u.provider_nano === null
                      ? "Unconfirmed"
                      : formatNano(u.provider_nano)}
                    {u.usage_uncertain ? " (known portion only)" : ""}
                  </td>
                  <td className="p-2">{formatNano(u.charge_nano)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="panel">
        <h2>Purchased credits and refund requests</h2>
        <p className="muted text-xs my-3">
          Request a manual refund of unused purchased credits. The requested
          amount is reserved during review; credits are reversed only after a
          verified provider refund. Sub-cent unused credit remains available.
        </p>
        {!purchases.length && <p>No purchases recorded.</p>}
        {purchases.map((p) => (
          <div key={p.id} className="border-t border-slate-100 mt-4 pt-4">
            <p>
              {usd(p.amount_cents)} · {p.status.replaceAll("_", " ")}
            </p>
            {p.purchaser_id === userId &&
              ["completed", "partially_refunded"].includes(p.status) && (
                <ActionForm actionName="credit-refund" className="stack mt-4">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="purchase" value={p.id} />
                  <input
                    type="hidden"
                    name="operationKey"
                    value={randomUUID()}
                  />
                  <label htmlFor={`refund-${p.id}`}>
                    Unused amount to request (USD)
                  </label>
                  <input
                    id={`refund-${p.id}`}
                    name="amountUsd"
                    inputMode="decimal"
                    placeholder="1.00"
                    required
                  />
                  <Button variant="outline">Request manual refund</Button>
                </ActionForm>
              )}
          </div>
        ))}
      </div>
      <details className="panel">
        <summary className="font-semibold cursor-pointer">
          Recent ledger entries
        </summary>
        <ul className="mt-4 space-y-3">
          {ledger.map((l) => (
            <li key={l.id} className="text-xs border-t border-slate-100 pt-3">
              {l.kind.replaceAll("_", " ")} · {l.source} ·{" "}
              {formatNano(l.amount_nano)} ·{" "}
              {new Date(l.created_at).toLocaleString("en-GB", {
                timeZone: "UTC",
              })}{" "}
              UTC
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

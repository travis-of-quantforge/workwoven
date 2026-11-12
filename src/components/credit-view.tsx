import { randomUUID } from "node:crypto";
import { ActionForm } from "./action-form";
import { Button } from "./ui/button";
import { formatTokens, TOKEN_ATOMS } from "@/lib/ai/pricing";
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
  cancelled = false,
}: {
  id: string;
  visibility: string;
  summary: Summary;
  ledger: Ledger[];
  usage: Usage[];
  purchases: Purchase[];
  userId: string;
  topupAmounts: number[];
  cancelled?: boolean;
}) {
  return (
    <div className="stack">
      <div className="panel">
        <p className="eyebrow">
          {visibility === "shared"
            ? "Shared project tokens"
            : `Your private ${visibility} tokens`}
        </p>
        <h2 className="mt-3">AI usage tokens</h2>
        <p className="muted my-3">
          10 Workspace tokens equal $1 of AI usage value. These are separate
          from professional payments.{" "}
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
                {formatTokens(value)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="muted text-xs mt-5">
          Available promotional tokens:{" "}
          {formatTokens(summary.promotionalAvailableNano)} · Available purchased
          tokens: {formatTokens(summary.purchasedAvailableNano)}
        </p>
        {cancelled && <p className="notice text-sm mt-4">Unused promotional tokens return to {visibility === "shared" ? "the engagement creator’s account" : "your account"}. Tokens still reserved for a request return when that reservation is released.</p>}
        {!cancelled && BigInt(summary.availableNano) < 10n * TOKEN_ATOMS && (
          <p className="notice text-sm mt-4">
            Tokens are low. Messages, files, approvals and existing records
            remain usable.
          </p>
        )}
        <div className="border-t border-slate-200 pt-5 mt-6">
          <h3>Token allocation</h3>
          <p className="notice text-sm my-4">
            During the hackathon, an authorised admin can allocate promotional
            demo tokens. PayPal checkout is not implemented; these
            disabled purchase amounts do not create a charge or tokens.
          </p>
          <div className="flex flex-wrap gap-3">
            {topupAmounts.map((c) => (
              <Button key={c} disabled>
                {usd(c)} · {formatTokens(BigInt(c) * 10000000n)}
              </Button>
            ))}
          </div>
          <p className="muted text-xs mt-4">
            The signup grant funds only the shared agent. Private use needs a
            separate admin allocation during the hackathon. On cancellation, unused promotional tokens return to the engagement creator’s account (shared) or the participant’s account (private). Reserved tokens return when released. Spent tokens are not returned, and promotional tokens have no cash value.
          </p>
        </div>
      </div>
      <div className="panel overflow-x-auto">
        <h2>Recent usage</h2>
        <p className="muted my-3 text-xs">
          Small charges retain fractional tokens. Internal failures and unusable
          results do not spend your tokens. Corrections appear in the ledger.
        </p>
        {!usage.length ? (
          <p>No AI usage recorded in this balance.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                <th className="p-2">Time (UTC)</th>
                <th className="p-2">Status</th>
                <th className="p-2">Tokens charged</th>
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
                    {formatTokens(u.charge_nano)}
                    {u.usage_uncertain ? " · usage uncertain" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="panel">
        <h2>Purchased tokens and refund requests</h2>
        <p className="muted text-xs my-3">
          Request a manual refund of unused purchased tokens. The requested
          amount is reserved during review; tokens are reversed only after a
          verified provider refund. Fractional unused tokens remain available.
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
              {formatTokens(l.amount_nano)} ·{" "}
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

export type LedgerEntry = {
  id: number;
  created_at: string;
  kind: string;
  amount_cents: number;
  currency: string;
  description: string;
  request_id: string;
  payment_id: string | null;
  refund_id: string | null;
  provider_reference: string | null;
  environment: string;
};
export const ledgerLabels: Record<string, string> = {
  request_created: "Requested",
  request_superseded: "Request superseded",
  order_created: "Awaiting PayPal approval",
  payment_processing: "Processing",
  payment_completed: "Paid",
  payment_failed: "Payment failed",
  payment_cancelled: "Checkout cancelled",
  refund_requested: "Refund processing",
  refund_completed: "Refunded",
  refund_failed: "Refund failed",
};
export function ledgerMovement(
  entry: Pick<LedgerEntry, "kind" | "amount_cents">,
) {
  return entry.kind === "payment_completed"
    ? BigInt(entry.amount_cents)
    : entry.kind === "refund_completed"
      ? -BigInt(entry.amount_cents)
      : 0n;
}
export function centsText(cents: bigint) {
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}
export function ledgerCsv(entries: LedgerEntry[]) {
  // Quoting protects CSV structure; an apostrophe also prevents spreadsheet
  // formula execution in user-authored text, including leading whitespace.
  const cell = (value: unknown, numeric = false) => {
    const text = String(value ?? "");
    const safe =
      !numeric && /^[\s\uFEFF]*[=+@-]/u.test(text) ? "'" + text : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const header = [
    "UTC timestamp",
    "Event",
    "Description",
    "Amount USD",
    "Net movement USD",
    "Currency",
    "Environment",
    "Request ID",
    "Payment ID",
    "Refund ID",
    "PayPal reference",
  ];
  return (
    "\uFEFF" +
    [
      header.map((value) => cell(value)).join(","),
      ...entries.map((e) =>
        [
          e.created_at,
          ledgerLabels[e.kind] || e.kind,
          e.description,
          centsText(BigInt(e.amount_cents)),
          centsText(ledgerMovement(e)),
          e.currency,
          e.environment,
          e.request_id,
          e.payment_id,
          e.refund_id,
          e.provider_reference,
        ]
          .map((value, index) => cell(value, index === 3 || index === 4))
          .join(","),
      ),
    ].join("\r\n") +
    "\r\n"
  );
}

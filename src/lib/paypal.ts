// Amounts must come from an accepted application record, never a browser or agent.
export function milestoneOrder(
  amountCents: bigint,
  merchantId: string,
  reference: string,
) {
  if (amountCents < 1n || amountCents > 100000000n)
    throw new Error("Invalid payment amount");
  if (!/^[A-Z0-9]{13}$/.test(merchantId))
    throw new Error("Invalid seller merchant ID");
  if (!/^[0-9a-f-]{36}$/i.test(reference))
    throw new Error("Invalid payment reference");
  const money = (cents: bigint) =>
    `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
  return {
    intent: "CAPTURE" as const,
    purchase_units: [
      {
        reference_id: reference,
        amount: { currency_code: "USD" as const, value: money(amountCents) },
        payee: { merchant_id: merchantId },
      },
    ],
  };
}

export function verifiedCapture(
  capture: unknown,
  orderId: string,
  amountCents: bigint,
  merchantId: string,
) {
  if (!capture || typeof capture !== "object") return false;
  const c = capture as Record<string, unknown>;
  const amount = c.amount as Record<string, unknown> | undefined;
  const payee = c.payee as Record<string, unknown> | undefined;
  const related = (c.supplementary_data as Record<string, unknown> | undefined)
    ?.related_ids as Record<string, unknown> | undefined;
  const money = `${amountCents / 100n}.${String(amountCents % 100n).padStart(2, "0")}`;
  const breakdown = c.seller_receivable_breakdown as
    Record<string, unknown> | undefined;
  const fees = breakdown?.platform_fees;
  return (
    c.status === "COMPLETED" &&
    typeof c.id === "string" &&
    c.id.length > 0 &&
    amount?.currency_code === "USD" &&
    amount.value === money &&
    payee?.merchant_id === merchantId &&
    related?.order_id === orderId &&
    (fees === undefined || (Array.isArray(fees) && fees.length === 0))
  );
}

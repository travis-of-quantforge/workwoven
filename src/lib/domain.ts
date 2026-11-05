import { z } from "zod";
import { milestonePlanSchema, changeSchema } from "./milestones";
export const visibilitySchema = z.enum(["shared", "client", "professional"]);
export const scopeSchema = z.object({
  deliverables: z.string().min(1).max(10000),
  exclusions: z.string().min(1).max(5000),
  assumptions: z.string().min(1).max(5000),
  responsibilities: z.string().min(1).max(5000),
  acceptanceCriteria: z.string().min(1).max(10000),
  priceCents: z.number().int().nonnegative().max(100000000),
  currency: z.literal("USD"),
  paymentTerms: z.string().min(1).max(5000),
  schedule: z.string().min(1).max(5000),
  milestones: milestonePlanSchema.optional(),
  change: changeSchema.optional(),
});
export function usd(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
export function usageCharge(providerNano: bigint) {
  if (providerNano < 0n) throw new Error("Invalid cost");
  return providerNano * 2n;
}
export function billableFailure(
  kind: "internal" | "provider" | "partial",
  retained: boolean,
  attributableNano: bigint | null,
) {
  return kind === "partial" && retained && attributableNano !== null
    ? usageCharge(attributableNano)
    : 0n;
}
export function reviewEligible(status: string, acceptedVersion: string | null) {
  return (
    ["completed", "cancelled"].includes(status) && acceptedVersion !== null
  );
}

export function parseUsd(value: unknown) {
  const text = z
    .string()
    .trim()
    .regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/)
    .parse(value);
  const [whole, fraction = ""] = text.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Amount is too large");
  return Number(cents);
}

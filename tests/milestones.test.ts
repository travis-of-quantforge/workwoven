import { expect, it } from "vitest";
import { milestonePlanSchema } from "../src/lib/milestones";
const a = {
  key: "70000000-0000-4000-8000-000000000001",
  title: "Build dashboard",
  owner: "professional",
  startDate: "2026-11-05",
  endDate: "2026-11-10",
  acceptanceCriteria: "Totals match CSV",
  paymentTerms: "After acceptance",
  amountCents: 100000,
  dependencies: [],
};
const b = {
  ...a,
  key: "70000000-0000-4000-8000-000000000002",
  title: "Review dashboard",
  startDate: "2026-11-10",
  endDate: "2026-11-12",
  dependencies: [a.key],
};
it("accepts a chronological dependency plan", () =>
  expect(milestonePlanSchema.parse([a, b])).toHaveLength(2));
it("rejects cycles, missing predecessors and duplicate keys", () => {
  for (const plan of [
    [{ ...a, dependencies: [b.key] }, b],
    [{ ...a, dependencies: [b.key] }],
    [a, a],
  ])
    expect(milestonePlanSchema.safeParse(plan).success).toBe(false);
});
it("rejects invalid calendar dates and dependencies that finish too late", () => {
  expect(
    milestonePlanSchema.safeParse([{ ...a, startDate: "2026-02-30" }]).success,
  ).toBe(false);
  expect(
    milestonePlanSchema.safeParse([a, { ...b, startDate: "2026-11-09" }])
      .success,
  ).toBe(false);
});

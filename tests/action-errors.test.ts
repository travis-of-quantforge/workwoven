import { it, expect } from "vitest";
import { z } from "zod";
import {
  databaseActionError,
  actionErrorMessage,
} from "../src/lib/action-errors";
it("returns actionable missing-schema and stale-version errors", () => {
  expect(
    actionErrorMessage(
      databaseActionError("PGRST205", "secret provider detail"),
    ),
  ).toContain("Apply the migrations");
  expect(
    actionErrorMessage(
      databaseActionError("P0001", "Stale version; refresh before submitting"),
    ),
  ).toContain("refresh");
});
it("does not reveal unexpected provider details", () => {
  expect(
    actionErrorMessage(
      databaseActionError("internal", "secret provider detail"),
    ),
  ).not.toContain("secret");
  expect(actionErrorMessage(new Error("secret credential"))).not.toContain(
    "secret",
  );
});
it("reports validation fields without echoing submitted values", () => {
  const r = z.object({ email: z.email() }).safeParse({ email: "private text" });
  expect(actionErrorMessage(r.error)).toContain("email");
  expect(actionErrorMessage(r.error)).not.toContain("private text");
});

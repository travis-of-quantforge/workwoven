import { expect, it } from "vitest";
import {
  calendarInvitation,
  localToUtc,
  localDateTime,
  overlaps,
} from "../src/lib/calendar";
it("converts local zones with fractional offsets", () => {
  expect(localToUtc("2026-11-10T15:00", "Africa/Johannesburg")).toBe(
    "2026-11-10T13:00:00.000Z",
  );
  expect(localToUtc("2026-11-10T15:00", "Asia/Kathmandu")).toBe(
    "2026-11-10T09:15:00.000Z",
  );
  expect(localDateTime("2026-11-10T13:00:00Z", "Africa/Johannesburg")).toBe(
    "2026-11-10T15:00",
  );
});
it("rejects nonexistent DST times and requires an explicit repeated-time choice", () => {
  expect(() => localToUtc("2026-03-08T02:30", "America/New_York")).toThrow(
    "does not exist",
  );
  expect(() => localToUtc("2026-11-01T01:30", "America/New_York")).toThrow(
    "occurs twice",
  );
  expect(localToUtc("2026-11-01T01:30", "America/New_York", "earlier")).toBe(
    "2026-11-01T05:30:00.000Z",
  );
  expect(localToUtc("2026-11-01T01:30", "America/New_York", "later")).toBe(
    "2026-11-01T06:30:00.000Z",
  );
});
it("rejects invalid dates and zones", () => {
  expect(() => localToUtc("2026-02-30T12:00", "UTC")).toThrow();
  expect(() => localToUtc("2026-11-10T12:00", "Invented/Timezone")).toThrow();
});
it("treats back-to-back meetings as non-overlapping", () => {
  const a = { start: "2026-11-10T12:00Z", end: "2026-11-10T13:00Z" };
  expect(overlaps(a, { start: a.end, end: "2026-11-10T14:00Z" })).toBe(false);
  expect(
    overlaps(a, { start: "2026-11-10T12:30Z", end: "2026-11-10T14:00Z" }),
  ).toBe(true);
});
it("exports stable revised ICS with escaped content and UTF-8-safe folding", () => {
  const event = {
    id: "stable-event",
    sequence: 2,
    updatedAt: "2026-11-04T10:00:00Z",
    start: "2026-11-10T13:00:00Z",
    end: "2026-11-10T13:30:00Z",
    title: "Review, dashboard; results",
    agenda: "Discuss 👩🏽‍💻 ".repeat(30) + "\r\nBEGIN:ATTACK",
    status: "CONFIRMED" as const,
    timezone: "Africa/Johannesburg",
    url: null,
  };
  const a = calendarInvitation(event),
    b = calendarInvitation({ ...event, sequence: 3, status: "CANCELLED" });
  expect(a).toContain("UID:stable-event@workspace.invalid\r\n");
  expect(b).toContain("SEQUENCE:3\r\n");
  expect(b).toContain("STATUS:CANCELLED");
  expect(a).toContain("SUMMARY:Review\\, dashboard\\; results");
  expect(a).not.toContain("\r\nBEGIN:ATTACK");
  expect(a).not.toContain("�");
  for (const line of a.split("\r\n"))
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
});

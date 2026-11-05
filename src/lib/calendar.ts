import { z } from "zod";
export function validTimezone(zone: string) {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
}
function parts(time: number, zone: string) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(time)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  );
}
export function localToUtc(
  local: string,
  zone: string,
  occurrence: "earlier" | "later" | "reject" = "reject",
) {
  if (!validTimezone(zone) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    throw new Error("Choose a valid local time and IANA timezone.");
  const [date, time] = local.split("T");
  z.iso.date().parse(date);
  z.iso.time().parse(time + ":00");
  const [y, m, d] = date.split("-").map(Number),
    [h, min] = time.split(":").map(Number);
  const target = Date.UTC(y, m - 1, d, h, min);
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const instant = target + hours * 3600000,
      p = parts(instant, zone);
    offsets.add(
      Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
        instant,
    );
  }
  const candidates = [...offsets]
    .map((offset) => target - offset)
    .filter((instant) => {
      const p = parts(instant, zone);
      return (
        p.year === y &&
        p.month === m &&
        p.day === d &&
        p.hour === h &&
        p.minute === min
      );
    })
    .sort((a, b) => a - b);
  if (!candidates.length)
    throw new Error(
      "That local time does not exist because the clock changes. Choose another time.",
    );
  if (candidates.length > 1 && occurrence === "reject")
    throw new Error(
      "That local time occurs twice. Choose the earlier or later occurrence.",
    );
  return new Date(
    occurrence === "later" ? candidates.at(-1)! : candidates[0],
  ).toISOString();
}
export function overlaps(
  a: { start: string; end: string },
  b: { start: string; end: string },
) {
  return (
    Date.parse(a.start) < Date.parse(b.end) &&
    Date.parse(b.start) < Date.parse(a.end)
  );
}
function escapeIcs(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}
// RFC 5545 folds by octets, never through a UTF-8 code point.
function fold(line: string) {
  const rows: string[] = [];
  let current = "";
  for (const char of line) {
    if (Buffer.byteLength(current + char, "utf8") > 75) {
      rows.push(current);
      current = " ";
    }
    current += char;
  }
  rows.push(current);
  return rows.join("\r\n");
}
function stamp(time: string) {
  const d = new Date(time);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid calendar time");
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
export function calendarInvitation(event: {
  id: string;
  sequence: number;
  updatedAt: string;
  start: string;
  end: string;
  title: string;
  agenda: string;
  status: "TENTATIVE" | "CONFIRMED" | "CANCELLED";
  timezone: string;
  url: string | null;
}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Workspace//Engagement meetings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.id}@workspace.invalid`,
    `SEQUENCE:${event.sequence}`,
    `DTSTAMP:${stamp(event.updatedAt)}`,
    `LAST-MODIFIED:${stamp(event.updatedAt)}`,
    `DTSTART:${stamp(event.start)}`,
    `DTEND:${stamp(event.end)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `DESCRIPTION:${escapeIcs(event.agenda + "\nProposed in " + event.timezone)}`,
    `STATUS:${event.status}`,
    ...(event.url ? [`URL:${escapeIcs(event.url)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function localDateTime(instant: string, zone: string) {
  const p = parts(Date.parse(instant), zone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

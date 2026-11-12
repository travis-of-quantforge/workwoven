import { boundedEvidence, type Evidence } from "./contracts";

// Reserve an excerpt for every supplied file/context record, rather than
// letting the first long discussion message consume the entire tool budget.
export function boundedMilestoneEvidence(rows: Evidence[], maxBytes = 30000) {
  let remaining = maxBytes;
  const selected: Evidence[] = [];
  for (let index = 0; index < rows.length; index++) {
    const share = Math.floor(remaining / (rows.length - index));
    const [source] = boundedEvidence([rows[index]], share);
    if (!source) throw new Error("Too many shared sources for one milestone draft. Reduce the attached context before retrying.");
    selected.push(source);
    remaining -= Buffer.byteLength(JSON.stringify(source), "utf8");
  }
  return selected;
}

export function milestoneFileCoverage(rows: Evidence[]) {
  const files = rows.filter(row => row.kind === "attachment");
  const unread = files.filter(row => row.state === "unavailable_text");
  const partial = files.some(row => row.excerpt && row.state !== "unavailable_text");
  const notes: string[] = [];
  if (unread.length) {
    const names = unread.slice(0, 5).map(row => row.body.split("\n")[0].replace(/^File: /, "").slice(0, 200));
    notes.push(`File contents not read: ${names.join(", ")}${unread.length > 5 ? ` and ${unread.length - 5} more` : ""}. Provide their text if they contain requirements.`);
  }
  if (partial) notes.push("Some shared files were available only as text excerpts; review the draft against the full files.");
  return notes.join(" ");
}

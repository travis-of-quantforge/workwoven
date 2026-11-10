import { it, expect } from "vitest";
import {
  validateGrounding,
  boundedEvidence,
  partialAnswer,
  type AgentResult,
  type Evidence,
  milestoneAgentResultSchema,
} from "../src/lib/ai/contracts";
const source: Evidence = {
  ref: "agreement:00000000-0000-0000-0000-000000000001",
  kind: "agreement",
  record_id: "00000000-0000-0000-0000-000000000001",
  version: "2",
  body: "Scheduled emails are excluded.",
  state: "agreed",
  source_visibility: "shared",
  excerpt: false,
};
it("rejects milestone drafts with no source citations", () => {
  const draft = milestoneAgentResultSchema.parse({ answer: "Suggested work", kind: "milestones", citations: [], questions: [], proposal: null, summary: null, milestones: [{ description: "Build the reporting dashboard" }] });
  expect(() => validateGrounding(draft, [])).toThrow("Milestone descriptions require supporting evidence");
});
const advice: AgentResult = {
  answer: "Email reports are excluded.",
  kind: "change",
  citations: [{ ref: source.ref, version: "2", visibility: "shared" }],
  questions: [],
  proposal: null,
  summary: null,
};
it("grounds a change in the exact accepted version", () => {
  expect(validateGrounding(advice, [source])).toEqual(advice);
  expect(() =>
    validateGrounding(
      { ...advice, citations: [{ ...advice.citations[0], version: "1" }] },
      [source],
    ),
  ).toThrow();
});
it("rejects unknown sources and wrong privacy labels", () => {
  expect(() =>
    validateGrounding(
      {
        ...advice,
        citations: [
          { ref: "message:unknown", version: "1", visibility: "shared" },
        ],
      },
      [source],
    ),
  ).toThrow();
  expect(() =>
    validateGrounding(
      {
        ...advice,
        citations: [{ ...advice.citations[0], visibility: "client" }],
      },
      [source],
    ),
  ).toThrow();
});
it("does not let a comparison omit the accepted agreement", () =>
  expect(() =>
    validateGrounding({ ...advice, citations: [] }, [source]),
  ).toThrow());
it("bounds escaped and Unicode evidence and labels excerpts without losing agreement state", () => {
  const result = boundedEvidence(
    [{ ...source, body: "\\\n💡".repeat(20000) }],
    1000,
  );
  expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(
    1002,
  );
  expect(result[0].excerpt).toBe(true);
  expect(result[0].state).toBe("agreed");
});
it("decodes draft text safely while JSON is still streaming", () => {
  expect(partialAnswer('{"answer":"First\\nSecond')).toBe("First\nSecond");
  expect(partialAnswer('{"answer":"Hi \\u26')).toBe("Hi ");
  expect(partialAnswer('{"other":"x"')).toBe("");
});

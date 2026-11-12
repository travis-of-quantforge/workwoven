import { describe, it, expect } from "vitest";
import {
  conversationReviewSchema,
  validateConversationReview,
  skippedQuestionThreshold,
} from "../src/lib/ai/conversation-checks";
import { reviewInput } from "../src/lib/ai/conversation-context";
const e = "engagement",
  f = "98000000-0000-4000-8000-000000000003";
const sources = [
  {
    ref: "message:one",
    version: "1",
    body: "Make it easy to update.",
    engagementId: e,
    visibility: "shared",
    date: "2026-11-12T10:00:00Z",
  },
  {
    ref: "message:two",
    version: "1",
    body: "I will edit content myself.",
    engagementId: e,
    visibility: "shared",
    date: "2026-11-12T11:00:00Z",
  },
];
const issue = {
  existingId: null,
  subject: "content editing",
  reopenReason: null,
  actionable: true,
  categories: ["ambiguity"],
  explanation: "Self-service or professional updates?",
  nextStep: "Which editing workflow do you expect?",
  references: [{ ref: "message:one", version: "1", quote: "easy to update" }],
  status: "awaiting_clarification",
  respondent: "client",
  reminderReason: null,
  questionRef: null,
  resolutionReferences: [],
};
const review = {
  summary: "Clarify editing expectations",
  coverage: "complete",
  findings: [issue],
};
describe("shared conversation review validation", () => {
  it("supports all six checks and a successful quiet conversation", () => {
    for (const category of [
      "scope",
      "ambiguity",
      "conflict",
      "understanding",
      "unanswered_question",
      "mediation",
    ])
      expect(
        conversationReviewSchema.parse({
          ...review,
          findings: [{ ...issue, categories: [category] }],
        }).findings,
      ).toHaveLength(1);
    expect(
      validateConversationReview(
        { ...review, findings: [] },
        e,
        sources,
        new Set(),
      ).findings,
    ).toEqual([]);
  });
  it("grounds grouped ambiguity and expectation against shared exact evidence", () => {
    expect(
      validateConversationReview(
        {
          ...review,
          findings: [
            { ...issue, categories: ["ambiguity", "understanding", "scope"] },
          ],
        },
        e,
        sources,
        new Set(),
      ).findings,
    ).toHaveLength(1);
    for (const changed of [
      { ...sources[0], visibility: "client" },
      { ...sources[0], engagementId: "other" },
      { ...sources[0], version: "2" },
      { ...sources[0], body: "not the quoted text" },
    ])
      expect(() =>
        validateConversationReview(review, e, [changed], new Set()),
      ).toThrow("Unsupported");
  });
  it("requires a known issue and later evidence for resolution", () => {
    const resolved = {
      ...issue,
      existingId: f,
      status: "resolved",
      actionable: false,
      resolutionReferences: [
        {
          ref: "message:two",
          version: "1",
          quote: "I will edit content myself.",
        },
      ],
    };
    expect(
      validateConversationReview(
        { ...review, findings: [resolved] },
        e,
        sources,
        new Set([f]),
      ).findings[0].status,
    ).toBe("resolved");
    expect(() =>
      validateConversationReview(
        { ...review, findings: [resolved] },
        e,
        sources,
        new Set(),
      ),
    ).toThrow("Unknown");
    expect(() =>
      validateConversationReview(
        { ...review, findings: [{ ...resolved, resolutionReferences: [] }] },
        e,
        sources,
        new Set([f]),
      ),
    ).toThrow("Resolution");
    expect(() =>
      validateConversationReview(
        { ...review, findings: [{ ...issue, status: "dismissed" }] },
        e,
        sources,
        new Set(),
      ),
    ).toThrow("Dismissal");
  });
  it("suppresses premature or incomplete-history unanswered-question reminders", () => {
    const q = {
      ...issue,
      categories: ["unanswered_question"],
      questionRef: "message:one",
      reminderReason: "skipped",
    };
    const policy = { complete: true, requested: false, threshold: 5 };
    expect(() =>
      validateConversationReview(
        { ...review, findings: [q] },
        e,
        sources,
        new Set(),
        policy,
      ),
    ).toThrow("premature");
    const later = Array.from({ length: 5 }, (_, i) => ({
      ...sources[1],
      ref: `message:later${i}`,
    }));
    expect(
      validateConversationReview(
        { ...review, findings: [q] },
        e,
        [sources[0], ...later],
        new Set(),
        policy,
      ).findings,
    ).toHaveLength(1);
    expect(() =>
      validateConversationReview(
        { ...review, findings: [q] },
        e,
        sources,
        new Set(),
        { ...policy, complete: false },
      ),
    ).toThrow("Incomplete");
    expect(() =>
      validateConversationReview(
        { ...review, findings: [{ ...q, reminderReason: "requested_review" }] },
        e,
        sources,
        new Set(),
        policy,
      ),
    ).toThrow("not requested");
    expect(
      validateConversationReview(
        { ...review, findings: [{ ...q, actionable: false }] },
        e,
        sources,
        new Set(),
        policy,
      ).findings[0].actionable,
    ).toBe(false);
  });
  it("bounds model context and records incomplete coverage instead of claiming all history was read", () => {
    const input = reviewInput({
      sources: Array.from({ length: 30 }, (_, i) => ({
        ref: `message:${i}`,
        version: "1",
        body: "x".repeat(5000),
        state: "discussed",
      })),
      findings: [],
      complete: true,
      requested: false,
    });
    expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThanOrEqual(48000);
    expect(input.complete).toBe(false);
  });
  it("defaults to five skipped messages and validates configuration", () => {
    expect(skippedQuestionThreshold(undefined)).toBe(5);
    expect(skippedQuestionThreshold("8")).toBe(8);
    for (const value of ["0", "-1", "five", "1.5", "101"])
      expect(() => skippedQuestionThreshold(value)).toThrow();
  });
});

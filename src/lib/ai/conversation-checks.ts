import { z } from "zod";

export const conversationCategories = z.enum([
  "scope",
  "ambiguity",
  "conflict",
  "understanding",
  "unanswered_question",
  "mediation",
]);
export const findingStatus = z.enum([
  "open",
  "awaiting_clarification",
  "resolved",
  "dismissed",
]);
const reference = z.object({
  ref: z.string().min(1),
  version: z.string().min(1),
  quote: z.string().min(1).max(2000),
});
export const conversationReviewSchema = z.object({
  summary: z.string().min(1).max(2000),
  coverage: z.enum(["complete", "incomplete"]),
  findings: z
    .array(
      z.object({
        existingId: z.uuid().nullable(),
        actionable: z.boolean(),
        subject: z.string().min(1).max(160),
        reopenReason: z.string().max(1000).nullable(),
        categories: z.array(conversationCategories).min(1).max(6),
        explanation: z.string().min(1).max(2000),
        nextStep: z.string().min(1).max(1000),
        references: z.array(reference).min(1).max(8),
        status: findingStatus,
        reminderReason: z
          .enum(["blocker", "imminent_decision", "skipped", "requested_review"])
          .nullable(),
        questionRef: z.string().nullable(),
        respondent: z.enum(["client", "professional", "both"]).nullable(),
        resolutionReferences: z.array(reference).max(8),
      }),
    )
    .max(8),
});
export type ConversationReview = z.infer<typeof conversationReviewSchema>;
export type SharedReviewSource = {
  ref: string;
  version: string;
  body: string;
  engagementId: string;
  visibility: string;
  date?: string;
  role?: string | null;
};

// Both initial evidence and resolution evidence must come from the authorised
// snapshot. Never accept a model-supplied ID as authority to retrieve a record.
export function validateConversationReview(
  value: unknown,
  engagementId: string,
  sources: SharedReviewSource[],
  existingIds: ReadonlySet<string>,
  policy?: { complete: boolean; requested: boolean; threshold: number },
) {
  const review = conversationReviewSchema.parse(value);
  const allowed = new Map(
    sources
      .filter(
        (s) => s.engagementId === engagementId && s.visibility === "shared",
      )
      .map((s) => [`${s.ref}@${s.version}`, s]),
  );
  for (const finding of review.findings) {
    if (!finding.existingId && finding.status === "resolved")
      throw new Error("New finding cannot be resolved");
    if (
      finding.categories.includes("unanswered_question") &&
      finding.actionable &&
      policy
    ) {
      if (!policy.complete)
        throw new Error(
          "Incomplete history cannot establish an unanswered question",
        );
      if (
        !finding.questionRef ||
        !finding.references.some((c) => c.ref === finding.questionRef)
      )
        throw new Error("Question evidence required");
      if (finding.reminderReason === "requested_review" && !policy.requested)
        throw new Error("Review was not requested");
      if (!finding.reminderReason) throw new Error("Reminder reason required");
      if (finding.reminderReason === "skipped") {
        const question = [...allowed.values()].find((s) => s.ref === finding.questionRef);
        const later = [...allowed.values()].filter((s) => s.ref.startsWith("message:") && s.date && question?.date && s.date > question.date);
        if (!question?.date || later.length < policy.threshold)
          throw new Error("Question reminder is premature");
        const respondentTurn = !!question.role && later.some((s) =>
          !!s.role && s.role !== question.role &&
          (!finding.respondent || finding.respondent === "both" || s.role === finding.respondent));
        if (!respondentTurn)
          throw new Error("Skipped question needs a later respondent turn");
      }
      if (
        ["blocker", "imminent_decision"].includes(finding.reminderReason) &&
        finding.references.length < 2
      )
        throw new Error("Reminder consequence needs supporting evidence");
    }
    if (finding.existingId && !existingIds.has(finding.existingId))
      throw new Error("Unknown finding");
    if (new Set(finding.categories).size !== finding.categories.length)
      throw new Error("Duplicate category");
    if (finding.status === "resolved" && !finding.resolutionReferences.length)
      throw new Error("Resolution evidence required");
    if (finding.status === "dismissed")
      throw new Error("Dismissal requires participant feedback");
    for (const citation of [
      ...finding.references,
      ...finding.resolutionReferences,
    ]) {
      const source = allowed.get(`${citation.ref}@${citation.version}`);
      if (!source || !source.body.includes(citation.quote))
        throw new Error("Unsupported shared evidence");
    }
  }
  return review;
}

export function skippedQuestionThreshold(value: string | undefined) {
  if (value === undefined) return 5;
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 100)
    throw new Error("Question threshold must be an integer from 1 to 100");
  return Number(value);
}

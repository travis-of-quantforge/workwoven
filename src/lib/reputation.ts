import { z } from "zod";
export const dimensionLabels: Record<string, string> = {
  communication: "Communication",
  clarity: "Clarity",
  collaboration: "Collaboration",
  honouringAgreements: "Honouring agreements",
  delivery: "Delivery",
};
export const publicProfileSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  company: z.string(),
  bio: z.string(),
  skills: z.array(z.string()),
  completionCount: z.number().int(),
  reviewCounts: z.object({
    client: z.number().int(),
    professional: z.number().int(),
  }),
  reviews: z.array(
    z.object({
      id: z.uuid(),
      body: z.string(),
      dimensions: z.record(z.string(), z.number()),
      reviewedRole: z.enum(["client", "professional"]),
      authorRole: z.enum(["client", "professional"]),
      authorName: z.string(),
      authorProfileId: z.uuid().nullable(),
      context: z.enum(["completed", "cancelled"]),
      publishedAt: z.string(),
      reply: z.string().nullable(),
    }),
  ),
  portfolio: z.array(
    z.object({ title: z.string(), description: z.string(), url: z.url() }),
  ),
  badges: z.array(
    z.object({
      title: z.string(),
      criteria: z.string(),
      awardedAt: z.string(),
    }),
  ),
});

import { z } from "zod";

export function activeMilestoneId(
  status: string,
  items: { id: string; accepted_version_id: string | null }[],
  versions: { id: string; task_id: string }[],
  tasks: { id: string; end_date: string }[],
  completedTaskIds: Set<string>,
) {
  if (status !== "active") return undefined;
  return items.flatMap(item => {
    const version = versions.find(v => v.id === item.accepted_version_id);
    const task = tasks.find(t => t.id === version?.task_id);
    return task && !completedTaskIds.has(task.id) ? [{ id: item.id, date: task.end_date }] : [];
  }).sort((a, b) => a.date.localeCompare(b.date))[0]?.id;
}
export const milestoneSuggestionSchema = z.object({
  description: z.string().trim().min(1).max(5000),
  acceptanceCriteria: z.string().trim().max(5000).nullable(),
  responsibilities: z.string().trim().max(5000).nullable(),
});

export function cleanMilestoneText(text:string) {
  return text.replace(/\[Sources?:[^\]]*\]/gi, "").trim();
}
export const milestoneSchema = z.object({
  key: z.uuid(),
  title: z.string().trim().min(1).max(200),
  owner: z.enum(["client", "professional"]),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  acceptanceCriteria: z.string().trim().min(1).max(5000),
  paymentTerms: z.string().trim().min(1).max(2000),
  amountCents: z.number().int().min(0).max(100000000),
  dependencies: z.array(z.uuid()).max(29),
});
export type Milestone = z.infer<typeof milestoneSchema>;
export const milestonePlanSchema = z
  .array(milestoneSchema)
  .max(30)
  .superRefine((tasks, ctx) => {
    const byKey = new Map(tasks.map((t) => [t.key, t]));
    if (byKey.size !== tasks.length)
      ctx.addIssue({
        code: "custom",
        message: "Milestone keys must be unique",
      });
    const done = new Set<string>(),
      active = new Set<string>();
    function visit(key: string): boolean {
      if (active.has(key)) return false;
      if (done.has(key)) return true;
      active.add(key);
      for (const d of byKey.get(key)?.dependencies || [])
        if (!visit(d)) return false;
      active.delete(key);
      done.add(key);
      return true;
    }
    tasks.forEach((t, i) => {
      if (
        t.endDate < t.startDate ||
        t.dependencies.some(
          (d) =>
            !byKey.has(d) || d === t.key || byKey.get(d)!.endDate > t.startDate,
        ) ||
        new Set(t.dependencies).size !== t.dependencies.length
      )
        ctx.addIssue({
          code: "custom",
          path: [i],
          message: "Check dates and predecessor dependencies",
        });
      if (!visit(t.key))
        ctx.addIssue({
          code: "custom",
          path: [i],
          message: "Dependencies must not contain a cycle",
        });
    });
  });
export const changeSchema = z.object({
  baseVersion: z.uuid(),
  reason: z.string().trim().min(1).max(3000),
  affectedReferences: z.string().trim().min(1).max(3000),
  costImpact: z.string().trim().min(1).max(3000),
  scheduleImpact: z.string().trim().min(1).max(3000),
});

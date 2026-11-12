import { beforeEach, afterEach, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
const fake = vi.hoisted(() => ({
  create: vi.fn(),
  rpc: vi.fn(),
  queries: [] as { table: string; filters: unknown[][] }[],
  job: {} as Record<string, unknown>,
}));
vi.mock("openai", () => ({
  default: class {
    responses = { create: fake.create };
  },
}));
vi.mock("../src/lib/supabase/admin", () => ({
  adminDatabase: () => ({
    rpc: fake.rpc,
    from: (table: string) => {
      const entry = { table, filters: [] as unknown[][] };
      fake.queries.push(entry);
      const query = {
        select: () => query,
        eq: (...args: unknown[]) => {
          entry.filters.push(args);
          return query;
        },
        in: (...args: unknown[]) => {
          entry.filters.push(args);
          return query;
        },
        lt: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: fake.job, error: null }),
        single: async () => ({
          data:
            table === "messages"
              ? {
                  body: "Please add scheduled emails.",
                  created_at: "2026-11-11T00:00:00Z",
                }
              : {
                  id: "price",
                  model: "fixture-model",
                  input_nano_per_token: 1,
                  cached_nano_per_token: 0,
                  output_nano_per_token: 10,
                  markup: 2,
                },
          error: null,
        }),
        then: (resolve: (value: unknown) => void) =>
          resolve({
            data: [{ body: "We agreed a CSV dashboard." }],
            error: null,
          }),
      };
      return query;
    },
  }),
}));
import {
  validateAssessment,
  processQueuedAssessment,
} from "../src/lib/ai/scope-monitor";
const terms = [
  {
    ref: "contract:accepted",
    version: "1",
    body: "Only CSV dashboards. Emails are excluded.",
  },
];
const result = {
  isRequest: true,
  verdict: "potential_conflict",
  summary: "Email reports may add excluded work.",
  issues: [
    {
      messageQuote: "scheduled emails",
      termRef: "contract:accepted",
      termQuote: "Emails are excluded.",
      explanation: "Discuss a revision before committing.",
    },
  ],
};
beforeEach(() => {
  fake.create.mockReset();
  fake.rpc.mockReset();
  fake.queries.length = 0;
  fake.job = {
    id: "job",
    engagement_id: "engagement",
    message_id: "source",
    actor_id: "actor",
    terms,
  };
  fake.rpc.mockImplementation(async (name: string) => ({
    data: name === "claim_message_assessment" ? "operation" : null,
    error: null,
  }));
  fake.create.mockResolvedValue({
    id: "response",
    status: "completed",
    model: "fixture-model",
    service_tier: "default",
    output_text: JSON.stringify(result),
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      input_tokens_details: { cached_tokens: 0 },
    },
  });
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("OPENAI_API_KEY", "fixture-key");
  vi.stubEnv("OPENAI_MODEL", "fixture-model");
});
afterEach(() => vi.unstubAllEnvs());
it("requires exact source quotes and accepted evidence references", () => {
  expect(
    validateAssessment(result, "Please add scheduled emails.", terms),
  ).toMatchObject({ verdict: "potential_conflict" });
  for (const issue of [
    { ...result.issues[0], messageQuote: "invented" },
    { ...result.issues[0], termRef: "private:secret" },
    { ...result.issues[0], termQuote: "made-up term" },
  ])
    expect(() =>
      validateAssessment(
        { ...result, issues: [issue] },
        "Please add scheduled emails.",
        terms,
      ),
    ).toThrow("Ungrounded");
  expect(() =>
    validateAssessment(
      { ...result, isRequest: false },
      "Please add scheduled emails.",
      terms,
    ),
  ).toThrow();
});
it("uses only shared discussion evidence, reserves first, meters actual usage and finishes once", async () => {
  await processQueuedAssessment("engagement");
  expect(fake.create).toHaveBeenCalledOnce();
  const request = fake.create.mock.calls[0][0];
  expect(JSON.parse(request.input[0].content)).toEqual({
    message: "Please add scheduled emails.",
    acceptedTerms: terms,
    recentDiscussionExcerpts: ["We agreed a CSV dashboard."],
  });
  expect(request).toMatchObject({
    model: "fixture-model",
    store: false,
    max_output_tokens: 1400,
  });
  for (const query of fake.queries.filter((q) => q.table === "messages")) {
    expect(query.filters).toContainEqual(["visibility", "shared"]);
    expect(query.filters).toContainEqual(["channel", "discussion"]);
    expect(query.filters).toContainEqual(["engagement_id", "engagement"]);
  }
  expect(fake.rpc.mock.calls.map((c) => c[0])).toEqual([
    "claim_message_assessment",
    "mark_usage_uncertain",
    "record_usage",
    "finish_message_assessment",
  ]);
  expect(fake.rpc).toHaveBeenCalledWith(
    "record_usage",
    expect.objectContaining({
      op_id: "operation",
      inputs: 100,
      cached: 0,
      outputs: 20,
    }),
  );
});
it("does not invoke the model when another worker won the claim or credits are unavailable", async () => {
  fake.rpc.mockResolvedValue({ data: null, error: null });
  await processQueuedAssessment();
  expect(fake.create).not.toHaveBeenCalled();
});
it("records failures for zero-charge settlement instead of publishing partial or ungrounded results", async () => {
  for (const response of [
    { status: "incomplete" },
    {
      output_text: JSON.stringify({
        ...result,
        issues: [{ ...result.issues[0], termQuote: "invented" }],
      }),
    },
  ]) {
    fake.create.mockResolvedValue({
      id: "response",
      status: "completed",
      model: "fixture-model",
      service_tier: "default",
      output_text: JSON.stringify(result),
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        input_tokens_details: { cached_tokens: 0 },
      },
      ...response,
    });
    await processQueuedAssessment();
  }
  expect(
    fake.rpc.mock.calls.filter((c) => c[0] === "fail_message_assessment"),
  ).toHaveLength(2);
  expect(
    fake.rpc.mock.calls.some((c) => c[0] === "finish_message_assessment"),
  ).toBe(false);
});
it("skips unavailable AI and oversized full-term context without reserving credits", async () => {
  vi.stubEnv("AI_ENABLED", "false");
  await processQueuedAssessment();
  vi.stubEnv("AI_ENABLED", "true");
  fake.job.terms = [{ ...terms[0], body: "x".repeat(50000) }];
  await processQueuedAssessment();
  expect(fake.create).not.toHaveBeenCalled();
  expect(
    fake.rpc.mock.calls.some((c) => c[0] === "claim_message_assessment"),
  ).toBe(false);
  expect(fake.rpc).toHaveBeenCalledWith("fail_message_assessment", {
    j: "job",
    why: "context_too_large",
  });
});

it("runs the extended review once through shared snapshot retrieval and the same metering", async () => {
  fake.job.review_version = 1;
  fake.rpc.mockImplementation(async(name:string)=>({data:name === "claim_message_assessment" ? "operation" : name === "prepare_conversation_review" ? {sources:[{ref:"message:source",version:"1",body:"Please add scheduled emails.",state:"discussed",date:"2026-11-12T00:00:00Z"}],findings:[],complete:true,requested:false} : null,error:null}));
  fake.create.mockResolvedValue({id:"response",status:"completed",model:"fixture-model",service_tier:"default",output_text:JSON.stringify({summary:"No actionable findings",coverage:"complete",findings:[]}),usage:{input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:0}}});
  await processQueuedAssessment("engagement");
  expect(fake.create).toHaveBeenCalledOnce();
  expect(fake.create.mock.calls[0][0].max_output_tokens).toBe(4096);
  expect(fake.rpc.mock.calls.map(c=>c[0])).toEqual(["prepare_conversation_review","claim_message_assessment","mark_usage_uncertain","record_usage","finish_conversation_review"]);
});

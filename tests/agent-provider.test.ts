import { beforeEach, it, expect, vi } from "vitest";
import type { Response } from "openai/resources/responses/responses";
const provider = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("openai", () => ({
  default: class {
    responses = { create: provider.create };
  },
}));
import { generateAgentResult } from "../src/lib/ai/openai";
import { milestoneAgentResultSchema, type Evidence } from "../src/lib/ai/contracts";
const price = {
  id: "fixture",
  model: "fixture",
  input_nano_per_token: 250,
  cached_nano_per_token: 25,
  output_nano_per_token: 2000,
  markup: 2,
};
const answer = {
  answer: "Please confirm the acceptance criteria.",
  kind: "advice" as const,
  citations: [],
  questions: ["Which CSV export should be used?"],
  proposal: null,
  summary: null,
};
const first = {
  id: "fixture-search",
  status: "completed",
  output: [
    {
      type: "function_call",
      id: "call-fixture",
      call_id: "fixture-call",
      name: "search_evidence",
      arguments: '{"query":"acceptance criteria"}',
      status: "completed",
    },
  ],
} as unknown as Response;
function streamed(status = "completed", payload: unknown = answer) {
  return (async function* () {
    yield { type: "response.output_text.delta", delta: JSON.stringify(payload) };
    yield {
      type:
        status === "completed" ? "response.completed" : "response.incomplete",
      response: {
        id: "fixture-answer",
        status,
        output_text: JSON.stringify(payload),
      },
    };
  })();
}
beforeEach(() => {
  vi.clearAllMocks();
  provider.create
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(streamed());
});
it("returns validated milestone suggestions through the existing bounded, metered provider flow", async () => {
  const source: Evidence = { ref: "message:00000000-0000-4000-8000-000000000001", kind: "message", record_id: "00000000-0000-4000-8000-000000000001", version: "1", body: "Build regional dashboard from CSV", state: "discussed", source_visibility: "shared", excerpt: false };
  const draft = { ...answer, kind: "milestones", citations: [{ ref: source.ref, version: "1", visibility: "shared" }], milestones: [{ description: "CSV dashboard with regional totals" }] };
  provider.create.mockReset().mockResolvedValueOnce(first).mockResolvedValueOnce(streamed("completed", draft));
  const meter = vi.fn();
  const result = await generateAgentResult(price, "shared", "milestones", "Draft milestone descriptions only from discussion.", { search: async () => [source], meter, preview: () => {}, status: () => {} }, new AbortController().signal);
  expect(milestoneAgentResultSchema.parse(result.result).milestones).toEqual(draft.milestones);
  expect(JSON.stringify(provider.create.mock.calls[1][0].input)).toContain(source.body);
  expect(meter).toHaveBeenCalledTimes(2);
  expect(provider.create).toHaveBeenCalledTimes(2);
  const schema = provider.create.mock.calls[1][0].text.format.schema;
  expect(schema.required).toContain("milestones");
  expect(JSON.stringify(schema.properties.milestones)).not.toContain("amountCents");
  expect(JSON.stringify(schema.properties.milestones)).not.toContain("targetDate");
  expect(milestoneAgentResultSchema.safeParse({ ...draft, proposal: { title: "AI-priced proposal" } }).success).toBe(false);
});
it("performs one bounded retrieval tool call and meters both provider responses", async () => {
  const hooks = {
    search: vi.fn().mockResolvedValue([]),
    meter: vi.fn().mockResolvedValue(undefined),
    preview: vi.fn(),
    status: vi.fn(),
  };
  const result = await generateAgentResult(
    price,
    "shared",
    "advice",
    "What needs clarification?",
    hooks,
    new AbortController().signal,
  );
  expect(result.result.answer).toBe(answer.answer);
  expect(hooks.search).toHaveBeenCalledWith("acceptance criteria");
  expect(hooks.meter).toHaveBeenCalledTimes(2);
  expect(provider.create).toHaveBeenCalledTimes(2);
  expect(provider.create.mock.calls[0][0]).toMatchObject({
    store: false,
    model: "fixture",
    parallel_tool_calls: false,
    tool_choice: { name: "search_evidence" },
  });
});
it("does not make another provider call if authorised retrieval fails", async () => {
  const meter = vi.fn();
  await expect(
    generateAgentResult(
      price,
      "client",
      "advice",
      "Question",
      {
        search: async () => {
          throw new Error("Forbidden");
        },
        meter,
        preview: () => {},
        status: () => {},
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow("Forbidden");
  expect(provider.create).toHaveBeenCalledTimes(1);
  expect(meter).toHaveBeenCalledOnce();
});
it("exposes only a validated usable partial as a consent offer", async () => {
  provider.create
    .mockReset()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(streamed("incomplete"));
  const result = await generateAgentResult(
    price,
    "shared",
    "advice",
    "Question",
    {
      search: async () => [],
      meter: async () => {},
      preview: () => {},
      status: () => {},
    },
    new AbortController().signal,
  );
  expect(result.partial).toBe(true);
  expect(result.result).toEqual(answer);
});

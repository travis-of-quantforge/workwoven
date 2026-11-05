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
function streamed(status = "completed") {
  return (async function* () {
    yield { type: "response.output_text.delta", delta: JSON.stringify(answer) };
    yield {
      type:
        status === "completed" ? "response.completed" : "response.incomplete",
      response: {
        id: "fixture-answer",
        status,
        output_text: JSON.stringify(answer),
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

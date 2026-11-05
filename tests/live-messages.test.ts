import { beforeEach, it, expect, vi } from "vitest";
const h = vi.hoisted(() => ({
  effect: undefined as undefined | (() => void | (() => void)),
  setState: vi.fn(),
  refresh: vi.fn(),
  getSession: vi.fn(),
  setAuth: vi.fn(),
  channel: vi.fn(),
  on: vi.fn(),
  subscribe: vi.fn(),
  removeChannel: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => void | (() => void)) => {
    h.effect = effect;
  },
  useState: () => ["connecting", h.setState],
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: h.refresh }),
}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: { getSession: h.getSession },
    realtime: { setAuth: h.setAuth },
    channel: h.channel,
    removeChannel: h.removeChannel,
  }),
}));
import { LiveMessages } from "../src/components/live-messages";
const subscription = { on: h.on, subscribe: h.subscribe };
beforeEach(() => {
  vi.clearAllMocks();
  h.getSession.mockResolvedValue({
    data: { session: { access_token: "fixture" } },
    error: null,
  });
  h.setAuth.mockResolvedValue(undefined);
  h.channel.mockReturnValue(subscription);
  h.on.mockReturnValue(subscription);
  h.subscribe.mockReturnValue(subscription);
  h.removeChannel.mockResolvedValue(undefined);
});
it("waits for browser authentication before joining Realtime", async () => {
  let authenticated!: () => void;
  h.setAuth.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        authenticated = resolve;
      }),
  );
  LiveMessages({ engagementId: "fixture" });
  h.effect!();
  await vi.waitFor(() => expect(h.setAuth).toHaveBeenCalled());
  expect(h.channel).not.toHaveBeenCalled();
  authenticated();
  await vi.waitFor(() => expect(h.channel).toHaveBeenCalledOnce());
});
it("does not join an anonymous subscription", async () => {
  h.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
  LiveMessages({ engagementId: "fixture" });
  h.effect!();
  await vi.waitFor(() =>
    expect(h.setState).toHaveBeenCalledWith("unavailable"),
  );
  expect(h.channel).not.toHaveBeenCalled();
});
it("cancels a pending connection when an effect is replaced", async () => {
  let session!: (value: unknown) => void;
  h.getSession.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        session = resolve;
      }),
  );
  LiveMessages({ engagementId: "fixture" });
  const dispose = h.effect!();
  if (typeof dispose === "function") dispose();
  session({ data: { session: { access_token: "fixture" } }, error: null });
  await Promise.resolve();
  await Promise.resolve();
  expect(h.channel).not.toHaveBeenCalled();
});
it("ignores late events after removing the old channel", async () => {
  LiveMessages({ engagementId: "fixture" });
  const dispose = h.effect!();
  await vi.waitFor(() => expect(h.subscribe).toHaveBeenCalledOnce());
  const onInsert = h.on.mock.calls[0][2];
  if (typeof dispose === "function") dispose();
  onInsert();
  expect(h.refresh).not.toHaveBeenCalled();
  expect(h.removeChannel).toHaveBeenCalledWith(subscription);
});

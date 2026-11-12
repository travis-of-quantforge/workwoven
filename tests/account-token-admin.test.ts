import { beforeEach, it, expect, vi } from "vitest";
const fake = vi.hoisted(() => ({ admin: true, rpc: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../src/lib/supabase/server", () => ({
  authenticated: async () => ({
    user: { id: "93000000-0000-4000-8000-000000000001" },
  }),
}));
vi.mock("../src/lib/supabase/admin", () => ({
  adminDatabase: () => ({ rpc: fake.rpc }),
}));
vi.mock("../src/lib/admin-access", () => ({
  isWorkspaceAdmin: () => fake.admin,
}));
import { setSignupTokens, adjustDemoCredits } from "../src/app/admin/actions";
const previous = { error: "", success: false };
function form(amount = "110") {
  const f = new FormData();
  f.set("amount", amount);
  f.set("key", "93000000-0000-4000-8000-000000000002");
  return f;
}
beforeEach(() => {
  fake.admin = true;
  fake.rpc.mockReset().mockResolvedValue({ error: null });
});
it("stores the signup allowance in token atoms, including an explicit zero", async () => {
  expect(await setSignupTokens(previous, form())).toEqual({
    error: "",
    success: true,
  });
  expect(fake.rpc).toHaveBeenLastCalledWith(
    "admin_set_signup_tokens",
    expect.objectContaining({ amount: "11000000000" }),
  );
  expect(await setSignupTokens(previous, form("0"))).toEqual({
    error: "",
    success: true,
  });
  expect(fake.rpc).toHaveBeenLastCalledWith(
    "admin_set_signup_tokens",
    expect.objectContaining({ amount: "0" }),
  );
});
it("rejects non-admin settings and balance changes before the service RPC", async () => {
  fake.admin = false;
  await expect(setSignupTokens(previous, form())).rejects.toThrow("Forbidden");
  await expect(adjustDemoCredits(previous, form())).rejects.toThrow(
    "Forbidden",
  );
  expect(fake.rpc).not.toHaveBeenCalled();
});
it("rejects invalid allowances without changing configuration", async () => {
  for (const amount of ["-1", "10001", "invalid"]) {
    expect((await setSignupTokens(previous, form(amount))).success).toBe(false);
  }
  expect(fake.rpc).not.toHaveBeenCalled();
});
it("routes personal account adjustments separately from engagement agent credits", async () => {
  const f = form("50");
  f.set("account", "93000000-0000-4000-8000-000000000003");
  f.set("direction", "add");
  f.set("reason", "Hackathon allocation");
  f.set("target", "wallet");
  expect((await adjustDemoCredits(previous, f)).success).toBe(true);
  expect(fake.rpc).toHaveBeenCalledWith(
    "admin_adjust_account_tokens",
    expect.objectContaining({
      subject: "93000000-0000-4000-8000-000000000003",
      delta: "5000000000",
    }),
  );
});

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import fs from "node:fs";
import { reservationBudget, type Price } from "../../src/lib/ai/pricing";
import { cleanupIntegrationRun } from "../../scripts/integration-fixtures.mjs";
function checked<
  T extends { data: unknown; error: { code?: string; message: string } | null },
>(r: T): NonNullable<T["data"]> {
  if (r.error || r.data === null)
    throw new Error(
      "Fixture operation failed (" + (r.error?.code || "provider error") + ")",
    );
  return r.data as NonNullable<T["data"]>;
}
test("real OpenAI response: evidence, two verified receipts, exact settlement and replay", async ({
  browser,
}) => {
  test.skip(
    !process.env.OPENAI_API_KEY ||
      !process.env.OPENAI_MODEL ||
      !process.env.SUPABASE_SECRET_KEY,
    "Requires explicitly configured providers",
  );
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
    publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    secret = process.env.SUPABASE_SECRET_KEY!;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, secret, options),
    run = randomUUID(),
    password = randomBytes(24).toString("base64url") + "aA1!";
  fs.mkdirSync(".integration-runs", { recursive: true });
  fs.writeFileSync(`.integration-runs/${run}.json`, JSON.stringify({ run }));
  const context = await browser.newContext();
  try {
    async function actor(side: string) {
      const email = `workspace-e2e-${run}-${side}@example.test`;
      const generated = checked(
        await admin.auth.admin.generateLink({
          type: "signup",
          email,
          password,
          options: { data: { workspace_test_run: run } },
        }),
      );
      if (!generated.properties || !generated.user)
        throw new Error("Fixture unavailable");
      const db = createClient(url, publicKey, options);
      checked(
        await db.auth.verifyOtp({
          type: "signup",
          token_hash: generated.properties.hashed_token,
        }),
      );
      return { email, id: generated.user.id, db };
    }
    const client = await actor("client"),
      pro = await actor("professional");
    const e = checked(
      await client.db.rpc("create_engagement", {
        p_title: "[E2E] Live AI " + run,
        p_role: "client",
      }),
    );
    checked(
      await admin
        .from("engagements")
        .update({ is_demo: true })
        .eq("id", e)
        .select("id"),
    );
    const invite = checked(
      await client.db.rpc("create_invitation", { e, target_email: pro.email }),
    );
    checked(await pro.db.rpc("accept_invitation", { t: invite }));
    const scope = checked(
      await pro.db.rpc("submit_scope", {
        e,
        expected: null,
        c: {
          deliverables:
            "CSV reporting dashboard with date and regional filters",
          exclusions: "Scheduled email reports and hosting",
          assumptions: "A representative UTF-8 CSV is supplied",
          responsibilities: "Client supplies sample CSV and reviews totals",
          acceptanceCriteria:
            "Regional and overall totals reconcile to the supplied CSV; date and region filters update figures",
          priceCents: 100000,
          currency: "USD",
          paymentTerms: "After accepted delivery",
          schedule: "Ten working days after sample data",
        },
      }),
    );
    for (const actor of [client, pro]) {
      const r = await actor.db.rpc("approve_scope", { s: scope });
      if (r.error) throw new Error("Fixture approval failed");
    }
    const canary = "PRIVATE_ONLY_" + randomUUID();
    checked(
      await client.db.rpc("send_message", {
        e,
        v: "client",
        b: canary + " internal CSV reporting budget",
      }),
    );
    checked(
      await pro.db.rpc("send_message", {
        e,
        v: "professional",
        b: "OPPOSING_" + canary + " professional estimates",
      }),
    );
    const price = checked(
      await admin
        .from("ai_pricing")
        .select("*")
        .eq("model", process.env.OPENAI_MODEL!)
        .eq("enabled", true)
        .order("effective_at", { ascending: false })
        .limit(1)
        .single(),
    ) as Price;
    const budget = reservationBudget(price);
    expect(budget <= 1000000000n).toBe(true);
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(client.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("http://127.0.0.1:3300/");
    const payload = {
      engagementId: e,
      visibility: "shared",
      mode: "advice",
      question:
        "Summarise the agreed dashboard acceptance criteria in two sentences. Cite the exact accepted agreement. Do not propose a scope change; use null for proposal and summary.",
      operationKey: randomUUID(),
    };
    const response = await page.request.post("/api/agents", {
      headers: { origin: "http://127.0.0.1:3300" },
      data: payload,
      timeout: 130000,
    });
    expect(response.status()).toBe(200);
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    expect(events.filter((e) => e.type === "error")).toEqual([]);
    const result = events.find((e) => e.type === "result");
    expect(result?.status).toBe("succeeded");
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(result.result.citations).toContainEqual({
      ref: `agreement:${scope}`,
      version: "1",
      visibility: "shared",
    });
    const operation = checked(
      await admin
        .from("usage_operations")
        .select("*")
        .eq("id", result.runId)
        .single(),
    );
    const metering = checked(
      await admin
        .from("usage_metering")
        .select("*")
        .eq("operation_id", operation.id),
    );
    expect(metering).toHaveLength(2);
    const providerNano = metering.reduce(
      (n, m) => n + BigInt(m.provider_nano),
      0n,
    );
    expect(providerNano > 0n).toBe(true);
    expect(BigInt(operation.charge_nano)).toBe(providerNano * 2n);
    expect(BigInt(operation.charge_nano) <= budget).toBe(true);
    expect(operation.status).toBe("settled");
    expect(operation.usage_uncertain).toBe(false);
    expect((await client.db.from("ai_pricing").select("id")).error).not.toBeNull();
    expect((await client.db.from("usage_metering").select("id")).error).not.toBeNull();
    expect((await client.db.from("usage_operations").select("provider_nano")).error).not.toBeNull();
    expect(checked(await client.db.from("usage_operations").select("charge_nano").eq("id", operation.id).single()).charge_nano).toBe(operation.charge_nano);
    for (const m of metering) {
      expect(m.pricing_id).toBe(price.id);
      expect(m.pricing_snapshot.model).toBe(price.model);
      expect(m.cached_tokens).toBe(0);
    }
    const balance = checked(
      await client.db.rpc("credit_summary", { e, v: "shared" }),
    );
    expect(BigInt(balance.availableNano)).toBe(
      5000000000n - BigInt(operation.charge_nano),
    );
    expect(balance.reservedNano).toBe("0");
    const replay = await page.request.post("/api/agents", {
      headers: { origin: "http://127.0.0.1:3300" },
      data: payload,
    });
    expect((await replay.json()).runId).toBe(operation.id);
    expect(
      checked(
        await admin
          .from("usage_metering")
          .select("id")
          .eq("operation_id", operation.id),
      ),
    ).toHaveLength(2);
    for (const [visibility, status] of [
      ["professional", 403],
      ["client", 409],
    ] as const) {
      const denied = await page.request.post("/api/agents", {
        headers: { origin: "http://127.0.0.1:3300" },
        data: { ...payload, visibility, operationKey: randomUUID() },
      });
      expect(denied.status()).toBe(status);
    }
    console.log(
      JSON.stringify({
        model: price.model,
        receipts: metering.length,
        providerNano: providerNano.toString(),
        customerChargeNano: String(operation.charge_nano),
        maximumNano: budget.toString(),
      }),
    );
  } finally {
    await context.close();
    await cleanupIntegrationRun(run, admin);
  }
});

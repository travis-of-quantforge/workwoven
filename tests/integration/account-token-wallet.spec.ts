import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import fs from "node:fs";
import { cleanupIntegrationRun } from "../../scripts/integration-fixtures.mjs";

test("signup allowance funds two engagements and blocks an unfunded third", async ({
  browser,
}) => {
  const run = randomUUID(),
    password = randomBytes(24).toString("base64url") + "aA1!",
    email = `workspace-e2e-${run}-wallet@example.test`;
  const options = { auth: { persistSession: false, autoRefreshToken: false } },
    url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = createClient(url, process.env.SUPABASE_SECRET_KEY!, options);
  fs.mkdirSync(".integration-runs", { recursive: true });
  fs.writeFileSync(`.integration-runs/${run}.json`, JSON.stringify({ run }));
  const context = await browser.newContext();
  try {
    const generated = await service.auth.admin.generateLink({
      type: "signup",
      email,
      password,
      options: { data: { workspace_test_run: run, profile_type: "client" } },
    });
    if (generated.error) throw new Error("Fixture signup failed");
    const db = createClient(
      url,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      options,
    );
    const verified = await db.auth.verifyOtp({
      type: "signup",
      token_hash: generated.data.properties.hashed_token,
    });
    expect(verified.error).toBeNull();
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("http://127.0.0.1:3200/");
    await expect(
      page.getByText("110 tokens available.", { exact: false }),
    ).toBeVisible();
    for (let i = 0; i < 2; i++) {
      await page
        .getByLabel("Engagement name", { exact: true })
        .fill(`[E2E] Wallet ${run} ${i}`);
      await page
        .getByRole("button", { name: "Create engagement", exact: true })
        .click();
      await expect(page).toHaveURL(/\/workspace\//);
      await expect(page.getByText("Funded", { exact: true })).toBeVisible();
      await expect(
        page.getByText("private setup draft", { exact: false }),
      ).toHaveCount(0);
      await page
        .getByRole("link", { name: "All engagements", exact: true })
        .click();
      await expect(
        page.getByText(`${i === 0 ? 60 : 10} tokens available.`, {
          exact: false,
        }),
      ).toBeVisible();
    }
    await expect(
      page.getByRole("button", { name: "Create engagement", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText(
        "You need at least 50 available tokens to create an engagement.",
        { exact: true },
      ),
    ).toBeVisible();
    const rejected = await db.rpc("create_engagement", {
      p_title: `[E2E] Rejected ${run}`,
    });
    expect(rejected.error?.message).toContain("50 available tokens");
    const projects = await db
      .from("engagements")
      .select("id,funding")
      .eq("creator_id", verified.data.user!.id);
    expect(projects.data).toHaveLength(2);
    expect(projects.data?.every((p) => p.funding === "funded")).toBe(true);
    const wallet = await db
      .from("account_token_wallets")
      .select("available_nano")
      .single();
    expect(wallet.data?.available_nano).toBe(1000000000);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/account-token-wallet-mobile.png",
      fullPage: true,
    });
  } finally {
    await context.close();
    await cleanupIntegrationRun(run, service);
  }
});

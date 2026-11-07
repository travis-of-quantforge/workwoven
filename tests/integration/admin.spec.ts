import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import fs from "node:fs";
import { cleanupIntegrationRun } from "../../scripts/integration-fixtures.mjs";

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const options = { auth: { persistSession: false, autoRefreshToken: false } };

test("admin can allocate demo credits; another verified user cannot open admin", async ({
  browser,
}) => {
  test.setTimeout(180000);
  test.skip(
    !projectUrl ||
      !publicKey ||
      !secretKey ||
      !process.env.SUPABASE_DB_URL ||
      !process.env.ADMIN_TEST_EMAIL,
    "Requires development Supabase and an isolated admin fixture email",
  );
  const service = createClient(projectUrl, secretKey, options);
  const run = randomUUID();
  fs.mkdirSync(".integration-runs", { recursive: true });
  fs.writeFileSync(`.integration-runs/${run}.json`, JSON.stringify({ run }));
  const password = randomBytes(24).toString("base64url") + "aA1!";
  async function fixture(email: string) {
    const generated = await service.auth.admin.generateLink({
      type: "signup",
      email,
      password,
      options: { data: { workspace_test_run: run } },
    });
    if (generated.error || !generated.data.properties)
      throw new Error("Unable to generate admin test account");
    const db = createClient(projectUrl, publicKey, options);
    const verified = await db.auth.verifyOtp({
      token_hash: generated.data.properties.hashed_token,
      type: "signup",
    });
    if (verified.error || !verified.data.user?.email_confirmed_at)
      throw new Error("Unable to verify admin test account");
    return db;
  }
  async function signIn(page: Page, email: string) {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("http://127.0.0.1:3200/");
  }
  try {
    const adminEmail = process.env.ADMIN_TEST_EMAIL!;
    const otherEmail = `workspace-e2e-${run}-other@example.test`;
    const adminDb = await fixture(adminEmail);
    await fixture(otherEmail);
    const first = await adminDb.rpc("create_engagement", {
      p_title: `[E2E] Admin first ${run}`,
      p_role: "client",
    });
    const pending = await adminDb.rpc("create_engagement", {
      p_title: `[E2E] Admin pending ${run}`,
      p_role: "client",
    });
    if (first.error || pending.error)
      throw new Error("Unable to create admin test engagements");

    const outsiderContext = await browser.newContext();
    const outsider = await outsiderContext.newPage();
    await signIn(outsider, otherEmail);
    await outsider.goto("/admin");
    await expect(outsider.getByText("Users and demo AI tokens")).toHaveCount(
      0,
    );
    await outsiderContext.close();

    const adminContext = await browser.newContext();
    const page = await adminContext.newPage();
    await signIn(page, adminEmail);
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "Users and demo AI tokens" }),
    ).toBeVisible();
    const project = page
      .locator("section.panel > div")
      .filter({ hasText: `[E2E] Admin pending ${run}` })
      .first();
    const shared = project
      .locator("div.rounded-lg")
      .filter({ hasText: "Shared project agent" });
    await shared.getByLabel("Workspace tokens").fill("50");
    await shared.getByLabel("Reason").fill("Hackathon browser fixture");
    await shared.getByRole("button", { name: "Apply" }).click();
    await expect(project.getByText("client · funded")).toBeVisible();
    await expect(
      shared.getByText("Available 50 tokens", { exact: false }),
    ).toBeVisible();
    const account = await service
      .from("agent_accounts")
      .select("id,available_nano")
      .eq("engagement_id", pending.data)
      .eq("visibility", "shared")
      .single();
    expect(account.error).toBeNull();
    expect(account.data?.available_nano).toBe(5000000000);
    const adjustment = await service
      .from("admin_credit_adjustments")
      .select("delta_nano,reason")
      .eq("account_id", account.data!.id)
      .single();
    expect(adjustment.error).toBeNull();
    expect(adjustment.data?.delta_nano).toBe(5000000000);
    expect(adjustment.data?.reason).toBe("Hackathon browser fixture");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("heading", { name: "Users and demo AI tokens" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await adminContext.close();
  } finally {
    await cleanupIntegrationRun(run, service);
  }
});

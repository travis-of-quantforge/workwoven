import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import { cleanupIntegrationRun } from "../../scripts/integration-fixtures.mjs";

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const options = { auth: { persistSession: false, autoRefreshToken: false } };

test("signup profile type and account switch drive dashboard and future engagement role", async ({
  browser,
}) => {
  test.setTimeout(180000);
  test.skip(
    !projectUrl || !publicKey || !secretKey || !process.env.SUPABASE_DB_URL,
    "Requires configured development Supabase",
  );
  const service = createClient(projectUrl, secretKey, options);
  const run = randomUUID();
  const email = `workspace-e2e-${run}-context@example.test`;
  const password = randomBytes(24).toString("base64url") + "aA1!";
  fs.mkdirSync(".integration-runs", { recursive: true });
  fs.writeFileSync(`.integration-runs/${run}.json`, JSON.stringify({ run }));
  try {
    const generated = await service.auth.admin.generateLink({
      type: "signup",
      email,
      password,
      options: {
        data: { workspace_test_run: run, profile_type: "professional" },
      },
    });
    if (generated.error || !generated.data.properties)
      throw new Error("Unable to generate account-context fixture");
    const db = createClient(projectUrl, publicKey, options);
    const verified = await db.auth.verifyOtp({
      token_hash: generated.data.properties.hashed_token,
      type: "signup",
    });
    if (verified.error || !verified.data.user?.email_confirmed_at)
      throw new Error("Unable to verify account-context fixture");
    const userId = verified.data.user.id;
    const context = await browser.newContext();
    try {
      const page: Page = await context.newPage();
      await page.goto("/login?mode=signup");
      await expect(page.getByLabel("Start as")).toBeVisible();
      await expect(
        page.getByRole("option", { name: "Freelancer / professional" }),
      ).toHaveCount(1);
      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Your professional engagements" }),
      ).toBeVisible();
      await page.goto("/profile");
      await expect(
        page.getByText("You started as a professional.", { exact: false }),
      ).toBeVisible();
      await page.goto("/");
      await page.getByText("Account · Professional").click();
      await page.getByRole("button", { name: "Switch to Client" }).click();
      await expect(
        page.getByRole("heading", { name: "Your client engagements" }),
      ).toBeVisible();
      const clientTitle = `[E2E] Client context ${run}`;
      await page.getByLabel("Engagement name").fill(clientTitle);
      await page.getByRole("button", { name: "Create engagement" }).click();
      await expect(
        page.getByRole("heading", { name: clientTitle }),
      ).toBeVisible();
      const clientEngagement = page.url().split("/workspace/")[1].split("?")[0];
      await expect(
        page.getByText("You are the client", { exact: false }),
      ).toBeVisible();
      await page.getByText("Account · Client").click();
      await page
        .getByRole("button", { name: "Switch to Professional" })
        .click();
      await expect(
        page.getByRole("heading", { name: "Your professional engagements" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: clientTitle }),
      ).toHaveCount(0);
      const proTitle = `[E2E] Professional context ${run}`;
      await page.getByLabel("Engagement name").fill(proTitle);
      await page.getByRole("button", { name: "Create engagement" }).click();
      await expect(
        page.getByText("You are the professional", { exact: false }),
      ).toBeVisible();
      const profile = await service
        .from("profiles")
        .select("default_role,active_role")
        .eq("id", userId)
        .single();
      expect(profile.data).toMatchObject({
        default_role: "professional",
        active_role: "professional",
      });
      const member = await service
        .from("memberships")
        .select("role")
        .eq("engagement_id", clientEngagement)
        .eq("user_id", userId)
        .single();
      expect(member.data?.role).toBe("client");
      const grants = await service
        .from("starter_grants")
        .select("user_id")
        .eq("user_id", userId);
      expect(grants.data).toHaveLength(1);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    } finally {
      await context.close();
    }
  } finally {
    await cleanupIntegrationRun(run, service);
  }
});

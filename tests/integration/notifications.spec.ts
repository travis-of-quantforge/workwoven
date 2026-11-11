import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import { cleanupIntegrationRun } from "../../scripts/integration-fixtures.mjs";

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const options = { auth: { persistSession: false, autoRefreshToken: false } };

test("professional notification bell opens with one unread message on desktop and mobile", async ({
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
      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Your professional engagements" })).toBeVisible();
      await page.getByLabel("Engagement name").fill(`[E2E] Notification ${run}`);
      await page.getByRole("button", { name: "Create engagement" }).click();
      await expect(page.getByRole("heading", { name: `[E2E] Notification ${run}` })).toBeVisible();
      const engagement = page.url().split("/workspace/")[1].split("?")[0];
      const inserted = await service.from("notifications").insert({recipient_id:userId, engagement_id:engagement, kind:"message", record_id:randomUUID()});
      expect(inserted.error).toBeNull();
      await page.goto("/");
      const bell = page.getByRole("button", {name:"Notifications, 1 unread", exact:true});
      await bell.click();
      await expect(page.getByRole("dialog", {name:"Notifications", exact:true})).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", {name:"Notifications", exact:true})).toBeHidden();
      const unhydrated = await browser.newContext({storageState:await context.storageState(), javaScriptEnabled:false});
      try {
        const plain = await unhydrated.newPage();
        // Isolate the rendered disclosure: Next's streamed page reveals async
        // boundaries with scripts, independently of this control's hydration.
        await plain.setContent(await bell.locator("..").evaluate(element => element.outerHTML));
        await plain.getByRole("button", {name:"Notifications, 1 unread", exact:true}).click();
        await expect(plain.getByRole("dialog", {name:"Notifications", exact:true})).toBeVisible();
        await expect(plain.getByRole("link", {name:"message", exact:true})).toBeVisible();
      } finally { await unhydrated.close(); }
      await page.setViewportSize({width:390,height:844});
      await bell.click();
      await expect(page.getByRole("button", {name:"Mark seen", exact:true})).toBeVisible();
      const bounds = await page.getByRole("dialog", {name:"Notifications", exact:true}).boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
      await page.getByRole("button", {name:"Mark seen", exact:true}).click();
      await expect(page.getByRole("button", {name:"Notifications, 0 unread", exact:true})).toBeVisible();
    } finally {
      await context.close();
    }
  } finally {
    await cleanupIntegrationRun(run, service);
  }
});

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
    const otherDb = await fixture(otherEmail);
    const unverifiedEmail = `workspace-e2e-${run}-unverified@example.test`;
    const unverified = await service.auth.admin.generateLink({ type: "signup", email: unverifiedEmail, password, options: { data: { workspace_test_run: run } } });
    if (unverified.error || !unverified.data.user) throw new Error("Unable to create unverified fixture");
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
    const token = await adminDb.rpc("create_invitation", { e: first.data, target_email: otherEmail });
    const accepted = await otherDb.rpc("accept_invitation", { t: token.data });
    if (token.error || accepted.error) throw new Error("Unable to join admin conversation fixture");
    const adminUser = (await adminDb.auth.getUser()).data.user!;
    const otherUser = (await otherDb.auth.getUser()).data.user!;
    const seeded = await service.from("messages").insert([
      { engagement_id: first.data, author_id: otherUser.id, visibility: "shared", body: "Shared admin conversation fixture" },
      { engagement_id: first.data, author_id: otherUser.id, visibility: "professional", body: "Professional private admin fixture" },
      { engagement_id: first.data, author_id: adminUser.id, visibility: "client", body: "Client private excluded fixture" },
    ]);
    if (seeded.error) throw new Error("Unable to seed admin conversations");

    const outsiderContext = await browser.newContext();
    const outsider = await outsiderContext.newPage();
    await signIn(outsider, otherEmail);
    await outsider.goto("/admin");
    await expect(outsider.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
    await outsider.getByLabel("Email", { exact: true }).fill(otherEmail);
    await outsider.getByLabel("Password", { exact: true }).fill(password);
    await outsider.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(outsider.getByRole("status")).toContainText("does not have admin access");
    await expect(outsider.getByText("Users and demo AI tokens")).toHaveCount(
      0,
    );
    await outsider.goto(`/admin/users/${adminUser.id}/conversations?engagement=${first.data}`);
    await expect(outsider.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
    await expect(outsider.getByRole("heading", { name: "User conversations" })).toHaveCount(0);
    await expect(outsider.getByText("Shared admin conversation fixture")).toHaveCount(0);
    await outsiderContext.close();

    const adminContext = await browser.newContext();
    const page = await adminContext.newPage();
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
    await page.getByLabel("Email", { exact: true }).fill(adminEmail);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("http://127.0.0.1:3200/admin");
    await expect(
      page.getByRole("heading", { name: "Users and demo AI tokens" }),
    ).toBeVisible();
    await expect(page.getByLabel("Free tokens on account creation",{exact:true})).toHaveValue("110");
    const personal = page.locator("section.panel").filter({has:page.getByRole("heading",{name:adminEmail,exact:true})}).locator("form").filter({has:page.locator('input[name="target"][value="wallet"]')});
    await personal.getByLabel("Workspace tokens",{exact:true}).fill("5");
    await personal.getByLabel("Reason",{exact:true}).fill("Personal wallet browser fixture");
    await personal.getByRole("button",{name:"Apply",exact:true}).click();
    const walletAfter=await service.from("account_token_wallets").select("available_nano").eq("user_id",adminUser.id).single();
    await expect.poll(async()=> (await service.from("account_token_wallets").select("available_nano").eq("user_id",adminUser.id).single()).data?.available_nano).toBe(1500000000);
    expect(walletAfter.error).toBeNull();
    const unverifiedCard = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: unverifiedEmail, exact: true }) });
    await expect(unverifiedCard.getByText("Email unverified", { exact: true })).toBeVisible();
    await unverifiedCard.getByRole("button", { name: "Verify email", exact: true }).click();
    await expect(unverifiedCard.getByText("Email verified", { exact: true }).first()).toBeVisible();
    const verifiedAccount = await service.auth.admin.getUserById(unverified.data.user.id);
    expect(verifiedAccount.data.user?.email_confirmed_at).toBeTruthy();
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
      shared.getByText("Available 100 tokens", { exact: false }),
    ).toBeVisible();
    const account = await service
      .from("agent_accounts")
      .select("id,available_nano")
      .eq("engagement_id", pending.data)
      .eq("visibility", "shared")
      .single();
    expect(account.error).toBeNull();
    expect(account.data?.available_nano).toBe(10000000000);
    const adjustment = await service
      .from("admin_credit_adjustments")
      .select("delta_nano,reason")
      .eq("account_id", account.data!.id)
      .single();
    expect(adjustment.error).toBeNull();
    expect(adjustment.data?.delta_nano).toBe(5000000000);
    expect(adjustment.data?.reason).toBe("Hackathon browser fixture");
    await page.goto(`/admin/users/${otherUser.id}/conversations?engagement=${first.data}`);
    await expect(page.getByText("Shared admin conversation fixture", { exact: true })).toBeVisible();
    await expect(page.getByText("Professional private admin fixture", { exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "User’s private conversation" }).click();
    await expect(page.getByText("Professional private admin fixture", { exact: true })).toBeVisible();
    await expect(page.getByText("Client private excluded fixture", { exact: true })).toHaveCount(0);
    const activity = await service.from("admin_activity").select("action").eq("actor_id", adminUser.id);
    expect(activity.error).toBeNull();
    expect(activity.data?.map((a) => a.action)).toEqual(expect.arrayContaining(["verify_email_requested", "verify_email_completed", "view_shared_conversation", "view_private_conversation"]));
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("heading", { name: "User conversations" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect((await adminDb.rpc("close_engagement",{e:first.data,target:"cancelled",expected:null,reason:"Admin list cancellation fixture."})).error).toBeNull();
    await page.goto("/admin");
    await expect(page.getByRole("link",{name:`[E2E] Admin first ${run}`,exact:true})).toHaveCount(0);
    await expect(page.getByRole("link",{name:`[E2E] Admin pending ${run}`,exact:true})).toBeVisible();
    // Isolated UI status fixtures; completion approval rules are tested elsewhere.
    for(const status of ["completed","archived"]){
      const fixture=await service.from("engagements").insert({creator_id:adminUser.id,title:`[E2E] Admin ${status} ${run}`,funding:"funded"}).select("id").single();expect(fixture.error).toBeNull();
      expect((await service.from("memberships").insert({engagement_id:fixture.data!.id,user_id:adminUser.id,role:"client"})).error).toBeNull();
      expect((await service.from("engagements").update({status}).eq("id",fixture.data!.id)).error).toBeNull();
    }
    await page.goto("/admin");
    for(const status of ["completed","archived"])await expect(page.getByRole("link",{name:`[E2E] Admin ${status} ${run}`,exact:true})).toHaveCount(0);
    await expect(page.getByRole("link",{name:`[E2E] Admin pending ${run}`,exact:true})).toBeVisible();
    await adminContext.close();
  } finally {
    await cleanupIntegrationRun(run, service);
  }
});

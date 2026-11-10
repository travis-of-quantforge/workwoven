import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import fs from "node:fs";
import { cleanupIntegrationRun } from "../../scripts/integration-fixtures.mjs";

test("milestone generation parses descriptions without an hourly rate and handles invalid results", async ({ browser }) => {
  test.skip(process.env.TEST_MILESTONE_GENERATION !== "mock", "Explicit browser-mocked generation mode required");
  test.setTimeout(120000);
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = createClient(url, process.env.SUPABASE_SECRET_KEY!, options);
  const run = randomUUID();
  fs.mkdirSync(".integration-runs", { recursive: true });
  fs.writeFileSync(`.integration-runs/${run}.json`, JSON.stringify({ run }));
  const email = `workspace-e2e-${run}-generation@example.test`;
  const password = randomBytes(24).toString("base64url") + "aA1!";
  const context = await browser.newContext();
  try {
    const generated = await service.auth.admin.generateLink({ type: "signup", email, password, options: { data: { workspace_test_run: run } } });
    if (generated.error) throw new Error("Fixture account unavailable");
    const db = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, options);
    const verified = await db.auth.verifyOtp({ token_hash: generated.data.properties.hashed_token, type: "signup" });
    if (verified.error) throw new Error("Fixture verification failed");
    const project = await db.rpc("create_engagement", { p_title: `[E2E] Description generation ${run}`, p_role: "client" });
    if (project.error) throw new Error(project.error.message);
    const page = await context.newPage();
    let requests = 0;
    await page.route("**/api/agents", async (route) => {
      const request = route.request().postDataJSON();
      expect(request.mode).toBe("milestones");
      expect(request.visibility).toBe("shared");
      requests++;
      const result = { kind: "milestones", answer: "Suggested descriptions for review.", citations: [], questions: [], proposal: null, summary: null,
        milestones: requests === 1 ? [{ description: "Build the CSV reporting dashboard." }, { description: "Prepare the handover guide." }] : "invalid" };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runId: randomUUID(), status: "succeeded", result }) });
    });
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("http://127.0.0.1:3200/");
    await page.goto(`/workspace/${project.data}?tab=discussion`);
    const emptyDraft = await page.request.post("/api/agents", {
      headers: { origin: "http://127.0.0.1:3200" },
      data: { engagementId: project.data, visibility: "shared", mode: "milestones", operationKey: randomUUID(), question: "Draft milestone descriptions from discussion." },
    });
    expect(emptyDraft.status()).toBe(409);
    expect((await emptyDraft.json()).error).toContain("Add your project goals");
    const untouched = await service.from("agent_accounts").select("available_nano,reserved_nano").eq("engagement_id", project.data).eq("visibility", "shared").single();
    expect(untouched.data?.available_nano).toBe(5000000000);
    expect(untouched.data?.reserved_nano).toBe(0);
    await page.getByRole("button", { name: "Propose milestones", exact: true }).click();
    const modal = page.getByRole("dialog");
    await expect(modal.getByText(/Professional hourly rate|NaN/)).toHaveCount(0);
    const create = modal.getByRole("button", { name: "Create milestones from discussion" });
    await expect(create).toBeEnabled();
    await create.click();
    await expect(modal.getByLabel("Description", { exact: true })).toHaveCount(2);
    await expect(modal.getByLabel("Description", { exact: true }).first()).toHaveValue("Build the CSV reporting dashboard.");
    await expect(modal.getByLabel("Description", { exact: true }).first()).toHaveCSS("color", "rgb(30, 58, 138)");
    for (const name of ["Amount on completion (USD)", "Target deadline"]) {
      await expect(modal.getByLabel(name).first()).toHaveValue("");
      await expect(modal.getByLabel(name).nth(1)).toHaveValue("");
    }
    await create.click();
    await expect(modal.getByRole("alert")).toContainText("The milestone draft could not be read");
    await expect(modal.getByText("Reading the shared discussion…", { exact: true })).toHaveCount(0);
    expect(requests).toBe(2);
  } finally {
    await context.close();
    await cleanupIntegrationRun(run, service);
  }
});

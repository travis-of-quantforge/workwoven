import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import { cleanupIntegrationRun } from "../../scripts/integration-fixtures.mjs";

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const options = { auth: { persistSession: false, autoRefreshToken: false } };

test("revoked invitation, mutual concern resolution, and accepted payment request", async ({
  browser,
}) => {
  test.setTimeout(240000);
  test.skip(
    !projectUrl || !publicKey || !secretKey || !process.env.SUPABASE_DB_URL,
    "Requires configured development Supabase",
  );
  const service = createClient(projectUrl, secretKey, options);
  const run = randomUUID();
  fs.mkdirSync(".integration-runs", { recursive: true });
  fs.writeFileSync(`.integration-runs/${run}.json`, JSON.stringify({ run }));
  const password = randomBytes(24).toString("base64url") + "aA1!";
  async function fixture(side: string) {
    const email = `workspace-e2e-${run}-${side}@example.test`;
    const generated = await service.auth.admin.generateLink({
      type: "signup",
      email,
      password,
        options: { data: { workspace_test_run: run, profile_type: side === "professional" ? "professional" : "client" } },
    });
    if (generated.error || !generated.data.properties)
      throw new Error("Unable to generate concern test account");
    const db = createClient(projectUrl, publicKey, options);
    if (side === "professional") return { email, db };
    const verified = await db.auth.verifyOtp({
      token_hash: generated.data.properties.hashed_token,
      type: "signup",
    });
    if (verified.error || !verified.data.user?.email_confirmed_at)
      throw new Error("Unable to verify concern test account");
    return { email, db };
  }
  async function signIn(page: Page, email: string) {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("http://127.0.0.1:3200/");
  }
  try {
    const client = await fixture("client");
    const professional = await fixture("professional");
    const created = await client.db.rpc("create_engagement", {
      p_title: `[E2E] Concern ${run}`,
      p_role: "client",
    });
    if (created.error || !created.data)
      throw new Error("Unable to create concern engagement");
    const id = created.data;
    const clientContext = await browser.newContext();
    const proContext = await browser.newContext();
    try {
      const cp = await clientContext.newPage();
      const pp = await proContext.newPage();
      await signIn(cp, client.email);
      await cp.goto(`/workspace/${id}?tab=discussion`);
      await cp.getByLabel("Their email").fill(professional.email);
      await cp.getByRole("button", { name: "Send invitation" }).click();
      await expect(cp).toHaveURL(/invite=/);
      const revokedToken = new URL(cp.url()).searchParams.get("invite");
      expect(revokedToken).toBeTruthy();
      await expect(cp.getByText("Pending invitation", { exact: true })).toBeVisible();
      await expect(cp.getByLabel("Their email")).toHaveCount(0);
      await expect(cp.getByRole("button", { name: "Send invitation" })).toHaveCount(0);
      await cp.getByRole("button", { name: "Revoke invitation", exact: true }).click();
      await expect(cp).toHaveURL(
        `http://127.0.0.1:3200/workspace/${id}?tab=discussion`,
      );
      await expect(cp.getByLabel("Their email")).toBeVisible();
      await cp.goto(`/invite/${revokedToken}`);
      await cp.getByRole("button", { name: "Accept invitation" }).click();
      await expect(cp.getByRole("alert")).toBeVisible();
      await cp.goto(`/workspace/${id}?tab=discussion`);

      await cp.getByLabel("Their email").fill(professional.email);
      await cp.getByRole("button", { name: "Send invitation" }).click();
      await expect(cp).toHaveURL(/invite=/);
      const freshToken = new URL(cp.url()).searchParams.get("invite");
      expect(freshToken).toBeTruthy();
      await cp.goto(`/invite/${freshToken}`);
      await cp.getByRole("button", { name: "Accept invitation" }).click();
      await expect(cp).toHaveURL(/\/login\?mode=signup&invitation=/);
      await expect(cp.getByRole("heading", { name: "Create your account" })).toBeVisible();
      await expect(cp.getByRole("status")).toHaveCount(0);
      await expect(cp.getByLabel("Email", { exact: true })).toHaveCount(0);
      await cp.getByLabel("Password", { exact: true }).fill(password);
      await cp.getByLabel("Confirm password", { exact: true }).fill(password + "typo");
      await cp.getByLabel("Hourly rate (USD)", { exact: true }).fill("50");
      await cp.getByRole("button", { name: "Create account", exact: true }).click();
      await expect(cp.getByRole("status")).toContainText("Passwords do not match");
      // Switching auth mode must preserve the invite without accepting it as the inviter.
      await cp.getByRole("link", { name: "Sign in", exact: true }).click();
      await expect(cp).toHaveURL(/mode=login&invitation=/);
      await pp.goto(`/invite/${freshToken}`);
      await pp.getByRole("button", { name: "Accept invitation" }).click();
      await expect(pp).toHaveURL(/mode=signup&invitation=/);
      await pp.getByLabel("Password", { exact: true }).fill(password);
      await pp.getByLabel("Confirm password", { exact: true }).fill(password);
      await pp.getByLabel("Hourly rate (USD)", { exact: true }).fill("50");
      await pp.getByRole("button", { name: "Create account", exact: true }).click();
      await expect(pp).toHaveURL(`http://127.0.0.1:3200/workspace/${id}`);
      const proLogin = await professional.db.auth.signInWithPassword({ email: professional.email, password });
      expect(proLogin.error).toBeNull();
      expect(proLogin.data.user?.email_confirmed_at).toBeTruthy();

      await cp.goto(`/workspace/${id}?tab=concerns`);
      await cp.getByText("Open a concern", { exact: true }).click();
      await cp.getByLabel("Short title").fill("Dashboard totals differ");
      await cp
        .getByLabel("What happened and what evidence matters?")
        .fill(
          "The sample CSV totals differ from the current dashboard calculation for two regions.",
        );
      await cp
        .getByLabel("What would you like to discuss?")
        .fill("Compare the CSV and agree how to correct the figures.");
      await cp.getByRole("button", { name: "Open shared concern" }).click();
      await expect(
        cp.getByRole("heading", { name: "Dashboard totals differ" }),
      ).toBeVisible();

      await pp.goto(`/workspace/${id}?tab=concerns`);
      await expect(
        pp.getByText("The sample CSV totals differ", { exact: false }),
      ).toBeVisible();
      await pp
        .getByLabel("Add your position or an option")
        .fill(
          "I will reconcile both regions against the sample CSV and share the calculation.",
        );
      await pp.getByRole("button", { name: "Post shared response" }).click();
      await expect(
        pp.getByText("I will reconcile both regions", { exact: false }),
      ).toBeVisible();
      await pp
        .getByRole("button", { name: "I consider this concern resolved" })
        .click();
      await expect(
        pp.getByText("Waiting for the other party", { exact: false }),
      ).toBeVisible();
      await cp.reload();
      await cp
        .getByRole("button", { name: "I consider this concern resolved" })
        .click();
      await expect(cp.getByText("Resolved by both parties")).toBeVisible();
      await cp.goto(`/workspace/${id}?tab=discussion`);
      await expect(
        cp.getByText("Concern opened: Dashboard totals differ", {
          exact: false,
        }),
      ).toBeVisible();
      const status = await service
        .from("engagements")
        .select("status,accepted_version_id")
        .eq("id", id)
        .single();
      expect(status.data?.status).toBe("discussion");
      expect(status.data?.accepted_version_id).toBeNull();
      await cp.setViewportSize({ width: 390, height: 844 });
      await cp.goto(`/workspace/${id}?tab=concerns`);
      expect(
        await cp.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);

      const scope = await client.db.rpc("submit_scope", {
        e: id,
        expected: null,
        c: {
          deliverables: "Reconcile dashboard totals against the supplied CSV.",
          exclusions: "Hosting",
          assumptions: "CSV supplied",
          responsibilities: "Client supplies representative CSV data.",
          acceptanceCriteria: "Regional totals match the supplied CSV.",
          priceCents: 12000,
          currency: "USD",
          paymentTerms: "After client acceptance",
          schedule: "Two weeks",
          milestones: [
            {
              key: randomUUID(),
              title: "Reconcile totals",
              owner: "professional",
              startDate: "2026-11-05",
              endDate: "2026-11-10",
              acceptanceCriteria: "Regional totals match CSV",
              paymentTerms: "After acceptance",
              amountCents: 10000,
              dependencies: [],
            },
          ],
        },
      });
      if (scope.error || !scope.data)
        throw new Error("Unable to submit payment test scope");
      const professionalApproval = await professional.db.rpc("approve_scope", {
        s: scope.data,
      });
      const clientApproval = await client.db.rpc("approve_scope", {
        s: scope.data,
      });
      expect(professionalApproval.error).toBeNull();
      expect(clientApproval.error).toBeNull();
      await pp.goto(`/workspace/${id}?tab=payments`);
      const task = await professional.db.from("milestone_tasks").select("id").eq("version_id", scope.data).single();
      const requested = await professional.db.rpc("request_milestone_payment", { e: id, t: task.data!.id, k: randomUUID() });
      expect(requested.error).toBeNull();
      await pp.reload();
      await expect(pp.getByRole("heading", { name: "Awaiting payment" })).toBeVisible();
      await expect(pp.getByRole("heading", { name: "Payment ledger" })).toBeVisible();
      const request = await service
        .from("payment_requests")
        .select("amount_cents,currency,status")
        .eq("engagement_id", id)
        .single();
      expect(request.error).toBeNull();
      expect(request.data).toMatchObject({
        amount_cents: 10000,
        currency: "USD",
        status: "requested",
      });
      await cp.goto(`/workspace/${id}?tab=payments`);
      await expect(
        cp.getByRole("heading", { name: "Awaiting payment" }),
      ).toBeVisible();
    } finally {
      await clientContext.close();
      await proContext.close();
    }
  } finally {
    await cleanupIntegrationRun(run, service);
  }
});

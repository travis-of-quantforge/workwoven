import { test, expect, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import fs from "node:fs";
import { cleanupIntegrationRun } from "../../scripts/integration-fixtures.mjs";

test("shared payment ledger: milestone request, hourly billing, client bonus, safe CSV and isolation", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
    options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, options),
    run = randomUUID(),
    password = randomBytes(24).toString("base64url") + "aA1!";
  fs.mkdirSync(".integration-runs", { recursive: true });
  fs.writeFileSync(`.integration-runs/${run}.json`, JSON.stringify({ run }));
  const contexts: BrowserContext[] = [];
  try {
    async function actor(role: string) {
      const email = `workspace-e2e-${run}-${role}@example.test`;
      const signup = await admin.auth.admin.generateLink({
        type: "signup",
        email,
        password,
        options: {
          data: {
            workspace_test_run: run,
            profile_type: role === "professional" ? "professional" : "client",
          },
        },
      });
      if (signup.error) throw new Error("Signup fixture unavailable");
      const db = createClient(
        url,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        options,
      );
      const verified = await db.auth.verifyOtp({
        type: "signup",
        token_hash: signup.data.properties.hashed_token,
      });
      if (verified.error) throw new Error("Verification fixture unavailable");
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL("http://127.0.0.1:3200/");
      return { email, db, page };
    }
    const c = await actor("client"),
      p = await actor("professional"),
      outside = await actor("outsider");
    const created = await c.db.rpc("create_engagement", {
      p_title: `[E2E] Sandbox payment ledger ${run}`,
      p_role: "client",
    });
    if (created.error) throw new Error(created.error.message);
    const e = created.data;
    const invited = await c.db.rpc("create_invitation", {
      e,
      target_email: p.email,
    });
    const joined = await p.db.rpc("accept_invitation", { t: invited.data });
    if (invited.error || joined.error) throw new Error("Join fixture failed");
    const submitted = await p.db.rpc("submit_individual_milestones", {
      e,
      k: randomUUID(),
      rows: [
        {
          description: "CSV dashboard handover",
          amountCents: 10000,
          targetDate: "2026-12-20",
          acceptanceCriteria: "Regional totals reconcile to CSV",
          responsibilities: "Supply representative CSV",
        },
      ],
    });
    if (submitted.error) throw new Error(submitted.error.message);
    const accepted = await c.db.rpc("accept_milestone", {
      v: submitted.data[0],
    });
    if (accepted.error) throw new Error(accepted.error.message);
    await c.db.rpc("send_message", {
      e,
      v: "client",
      b: "PRIVATE_LEDGER_SECRET",
    });
    await p.page.goto(`/workspace/${e}?tab=milestones`);
    await expect(
      p.page
        .getByLabel("Milestone payment")
        .getByText("Not paid · sandbox", { exact: true }),
    ).toBeVisible();
    await p.page
      .getByRole("button", { name: "Request milestone payment" })
      .click();
    await expect(
      p.page.getByText("Payment requested", { exact: true }),
    ).toBeVisible();
    await p.page.getByRole("link", { name: "payments", exact: true }).click();
    await expect(
      p.page.getByRole("heading", { name: "Payments", exact: true }),
    ).toBeVisible();
    await p.page.getByLabel("Payment type").selectOption("hourly");
    await p.page
      .getByLabel("What is this payment for?")
      .fill("=SUM(1,2)\nFive hours of November reporting support");
    await p.page.getByLabel("Amount (USD)", { exact: true }).fill("400");
    await p.page
      .getByRole("button", { name: "Request payment", exact: true })
      .click();
    await expect(
      p.page.getByRole("heading", { name: "Awaiting payment" }),
    ).toBeVisible();
    await c.page.goto(`/workspace/${e}?tab=payments`);
    await c.page
      .getByLabel("Bonus reason")
      .fill("Thank you for the careful handover");
    await c.page.getByLabel("Amount (USD)", { exact: true }).fill("25");
    await c.page
      .getByRole("button", { name: "Create bonus", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await c.db
              .from("payment_requests")
              .select("id")
              .eq("engagement_id", e)
          ).data?.length,
      )
      .toBe(3);
    const requests = await c.db
      .from("payment_requests")
      .select("kind,amount_cents,status")
      .eq("engagement_id", e);
    expect(requests.data).toHaveLength(3);
    expect(requests.data!.every((r) => r.status === "requested")).toBe(true);
    const totals = await c.db.rpc("payment_ledger_totals", { e });
    expect(totals.data).toEqual({ paidCents: "0", refundedCents: "0" });
    const csv = await c.page.request.get(
      `/api/engagements/${e}/payments/export`,
    );
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(csv.headers()["cache-control"]).toContain("no-store");
    const text = await csv.text();
    expect(text).toContain("CSV dashboard handover");
    expect(text).toContain("'=" + "SUM(1,2)");
    expect(text).toContain("Thank you for the careful handover");
    expect(text).not.toContain("PRIVATE_LEDGER_SECRET");
    expect(text).toContain('"0.00"');
    expect(
      (
        await outside.page.request.get(`/api/engagements/${e}/payments/export`)
      ).status(),
    ).toBe(404);
    const proCsv = await p.page.request.get(
      `/api/engagements/${e}/payments/export`,
    );
    expect(await proCsv.text()).toBe(text);
    // A forged checkout query and unsigned webhook cannot turn a request into paid.
    await c.page.goto(`/workspace/${e}?tab=payments&checkout=${randomUUID()}`);
    await expect(
      c.page.getByRole("heading", { name: "Finish your sandbox payment" }),
    ).toHaveCount(0);
    const unsigned = await c.page.request.post("/api/paypal/webhook", {
      data: {
        id: "UNSIGNED",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: { id: "FORGED" },
      },
    });
    expect([400, 503]).toContain(unsigned.status());
    expect(
      (
        await c.db
          .from("payment_transactions")
          .select("id")
          .eq("engagement_id", e)
      ).data,
    ).toHaveLength(0);
    await c.page.screenshot({
      path: "test-results/payment-ledger-desktop.png",
      fullPage: true,
    });
    await c.page.setViewportSize({ width: 390, height: 844 });
    await c.page.screenshot({
      path: "test-results/payment-ledger-mobile.png",
      fullPage: true,
    });
    expect(
      await c.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    for (const context of contexts) await context.close();
    await cleanupIntegrationRun(run, admin);
  }
});

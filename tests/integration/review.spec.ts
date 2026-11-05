import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import fs from "node:fs";
import { cleanupIntegrationRun } from "../../scripts/integration-fixtures.mjs";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  secret = process.env.SUPABASE_SECRET_KEY!;
function data<T extends { data: unknown; error: { message: string } | null }>(
  r: T,
): NonNullable<T["data"]> {
  if (r.error || r.data === null) throw new Error("Fixture operation failed");
  return r.data as NonNullable<T["data"]>;
}

test("completion transition preserves review form and publishes only after both submissions", async ({
  browser,
}) => {
  test.setTimeout(180000);
  test.skip(!url || !secret || !key, "Requires development Supabase");
  const run = randomUUID(),
    password = randomBytes(24).toString("base64url") + "aA1!";
  const admin = createClient(url, secret, { auth: { persistSession: false } });
  fs.mkdirSync(".integration-runs", { recursive: true });
  fs.writeFileSync(`.integration-runs/${run}.json`, JSON.stringify({ run }));
  const contexts = [];
  try {
    async function actor(side: string) {
      const email = `workspace-e2e-${run}-${side}@example.test`;
      const generated = data(
        await admin.auth.admin.generateLink({
          type: "signup",
          email,
          password,
          options: { data: { workspace_test_run: run } },
        }),
      );
      if (!generated.properties || !generated.user)
        throw new Error("Fixture user unavailable");
      const db = createClient(url, key, { auth: { persistSession: false } });
      data(
        await db.auth.verifyOtp({
          type: "signup",
          token_hash: generated.properties.hashed_token,
        }),
      );
      return { email, db, id: generated.user.id };
    }
    const client = await actor("client"),
      professional = await actor("professional");
    const e = data(
      await client.db.rpc("create_engagement", {
        p_title: "[E2E] Focused review " + run,
        p_role: "client",
      }),
    );
    data(
      await admin
        .from("engagements")
        .update({ is_demo: true })
        .eq("id", e)
        .select("id"),
    );
    const token = data(
      await client.db.rpc("create_invitation", {
        e,
        target_email: professional.email,
      }),
    );
    data(await professional.db.rpc("accept_invitation", { t: token }));
    const s = data(
      await client.db.rpc("submit_scope", {
        e,
        expected: null,
        c: {
          deliverables: "Dashboard",
          exclusions: "Email",
          assumptions: "CSV",
          responsibilities: "Data",
          acceptanceCriteria: "Totals match",
          priceCents: 10000,
          currency: "USD",
          paymentTerms: "On acceptance",
          schedule: "Two weeks",
        },
      }),
    );
    for (const actor of [client, professional]) {
      const r = await actor.db.rpc("approve_scope", { s });
      if (r.error) throw new Error("Fixture approval failed");
    }
    const pages = [];
    for (const actor of [client, professional]) {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      pages.push(page);
      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(actor.email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL("http://127.0.0.1:3200/");
      await page.goto(`/workspace/${e}?tab=reputation`);
    }
    const [cp, pp] = pages;
    for (const [page, role] of [
      [cp, "client"],
      [pp, "professional"],
    ] as const) {
      if (role === "professional") await page.reload();
      await page
        .getByLabel("Outcome reason", { exact: true })
        .fill("The accepted work has been completed and handed over.");
      await page
        .getByRole("checkbox", {
          name: "I confirm this action for my party.",
          exact: true,
        })
        .check();
      await page
        .getByRole("button", {
          name: `Confirm completion as ${role}`,
          exact: true,
        })
        .click();
      if (role === "client")
        await expect(
          page.getByText("Completion confirmations: client", { exact: true }),
        ).toBeVisible();
    }
    const body =
      "[E2E] The client supplied clear requirements and reviewed promptly.";
    await pp
      .getByLabel("Written feedback about the client", { exact: true })
      .fill(body);
    for (const name of [
      "Communication (1–5)",
      "Clarity (1–5)",
      "Collaboration (1–5)",
      "Honouring agreements (1–5)",
    ])
      await pp.getByLabel(name, { exact: true }).selectOption("5");
    await pp
      .getByRole("checkbox", {
        name: "I have reviewed this exact feedback and understand it is frozen on submission.",
        exact: true,
      })
      .check();
    const form = pp.locator("form").filter({
      has: pp.getByRole("button", {
        name: "Submit private feedback",
        exact: true,
      }),
    });
    expect(
      await form.evaluate((f) =>
        new FormData(f as HTMLFormElement).get("_action"),
      ),
    ).toBe("review");
    await pp
      .getByRole("button", { name: "Submit private feedback", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          data(
            await professional.db
              .from("reviews")
              .select("id")
              .eq("engagement_id", e),
          ).length,
      )
      .toBe(1);
    await expect(
      pp.getByText(
        "Your feedback is submitted and frozen. The counterparty cannot read it yet.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      data(await client.db.from("reviews").select("id").eq("engagement_id", e)),
    ).toEqual([]);
    await cp.reload();
    await cp
      .getByLabel("Written feedback about the professional", { exact: true })
      .fill(
        "[E2E] The professional delivered the agreed work and explained assumptions.",
      );
    for (const name of [
      "Communication (1–5)",
      "Delivery (1–5)",
      "Collaboration (1–5)",
      "Honouring agreements (1–5)",
    ])
      await cp.getByLabel(name, { exact: true }).selectOption("5");
    await cp
      .getByRole("checkbox", {
        name: "I have reviewed this exact feedback and understand it is frozen on submission.",
        exact: true,
      })
      .check();
    await cp
      .getByRole("button", { name: "Submit private feedback", exact: true })
      .click();
    await expect(cp.getByText(body, { exact: true })).toBeVisible();
    expect(
      data(await client.db.from("reviews").select("id").eq("engagement_id", e)),
    ).toHaveLength(2);
    await cp
      .getByLabel("Your public reply", { exact: true })
      .fill("[E2E] Thank you for the clear written feedback.");
    await cp
      .getByRole("button", { name: "Submit frozen reply", exact: true })
      .click();
    await expect(
      cp
        .locator("p.notice")
        .filter({ hasText: "[E2E] Thank you for the clear written feedback." }),
    ).toBeVisible();
    expect(
      data(
        await client.db
          .from("review_replies")
          .select("body")
          .eq("author_id", client.id),
      ),
    ).toHaveLength(1);
    await cp.screenshot({
      path: "test-results/integration-reputation-stable.png",
      fullPage: true,
    });
    await cp.setViewportSize({ width: 390, height: 844 });
    expect(
      await cp.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await cp.screenshot({
      path: "test-results/integration-reputation-mobile.png",
      fullPage: true,
    });
  } finally {
    for (const c of contexts) await c.close();
    await cleanupIntegrationRun(run, admin);
  }
});

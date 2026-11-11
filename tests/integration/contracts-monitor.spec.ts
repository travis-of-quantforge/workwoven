import { test, expect, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import fs from "node:fs";
import { cleanupIntegrationRun } from "../../scripts/integration-fixtures.mjs";
import { reservationBudget, type Price } from "../../src/lib/ai/pricing";

test("contract creation, dual approval, private isolation and a grounded shared scope notice", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const run = randomUUID(),
    password = randomBytes(24).toString("base64url") + "aA1!";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
    options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, options);
  const contexts: BrowserContext[] = [];
  fs.mkdirSync(".integration-runs", { recursive: true });
  fs.writeFileSync(`.integration-runs/${run}.json`, JSON.stringify({ run }));
  try {
    async function actor(role: string) {
      const email = `workspace-e2e-${run}-${role}@example.test`;
      const generated = await admin.auth.admin.generateLink({
        type: "signup",
        email,
        password,
        options: { data: { workspace_test_run: run, profile_type: role } },
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
      if (verified.error) throw new Error("Fixture verification failed");
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL("http://127.0.0.1:3200/");
      return { email, db, page, user: verified.data.user! };
    }
    const client = await actor("client"),
      pro = await actor("professional"),
      outsider = await actor("outsider");
    const body =
      "Only CSV dashboards are included. Scheduled email reports are excluded. Client supplies CSV data.";
    await client.page
      .getByLabel("Engagement name")
      .fill(`[E2E] Contract ${run}`);
    await client.page
      .getByText("Contract · editable starting template", { exact: true })
      .click();
    await client.page.getByLabel("Starting contract").selectOption("support");
    await expect(client.page.getByLabel("Contract draft")).toHaveValue(
      /ONGOING SUPPORT AND MAINTENANCE/,
    );
    await client.page.getByLabel("Starting contract").selectOption("custom");
    await client.page.getByLabel("Contract draft").fill(body);
    await client.page
      .getByRole("button", { name: "Create engagement", exact: true })
      .click();
    await expect(
      client.page.getByRole("heading", {
        name: `[E2E] Contract ${run}`,
        exact: true,
      }),
    ).toBeVisible();
    const e = client.page.url().split("/workspace/")[1].split("?")[0];
    const invite = await client.db.rpc("create_invitation", {
      e,
      target_email: pro.email,
    });
    expect(invite.error).toBeNull();
    expect(
      (await pro.db.rpc("accept_invitation", { t: invite.data })).error,
    ).toBeNull();
    // Tab changes must keep the shell and live subscription mounted, including
    // while the server response is delayed (no full-workspace fallback).
    await client.page.evaluate(() => {
      const header = document.querySelector("main > header")!;
      header.setAttribute("data-navigation-test", "preserved");
      const observer = new MutationObserver(() => {
        if (!header.isConnected) document.documentElement.dataset.shellRemoved = "true";
        if (!header.checkVisibility()) document.documentElement.dataset.shellHidden = "true";
        if (/Loading your workspace|Loading tab…/.test(document.body.innerText))
          document.documentElement.dataset.loadingFlashed = "true";
      });
      observer.observe(document.body, { childList: true, attributes: true, subtree: true });
    });
    let releaseTab!: () => void;
    let requestStarted!: () => void;
    const tabGate = new Promise<void>((resolve) => { releaseTab = resolve; });
    const tabRequested = new Promise<void>((resolve) => { requestStarted = resolve; });
    await client.page.route("**/workspace/**", async (route) => {
      if (route.request().method() === "GET" && route.request().url().includes("tab=contract")) {
        requestStarted();
        await tabGate;
      }
      await route.continue();
    });
    await client.page
      .getByRole("link", { name: "contract", exact: true })
      .click();
    try {
      await tabRequested;
      await expect(client.page.getByRole("status", { name: "Loading tab", exact: true })).toBeVisible();
      await expect(client.page.getByRole("heading", { name: "Discussion", exact: true })).toBeVisible();
      await expect(client.page.getByRole("button", { name: "Send message", exact: true })).toBeVisible();
      await expect(client.page.locator("main > header")).toBeVisible();
    } finally { releaseTab(); }
    await expect(client.page.getByLabel("Contract text")).toHaveValue(body);
    await expect(client.page.locator("main > header")).toHaveAttribute("data-navigation-test", "preserved");
    await expect(client.page.locator("html")).not.toHaveAttribute("data-shell-removed", "true");
    await expect(client.page.locator("html")).not.toHaveAttribute("data-shell-hidden", "true");
    await expect(client.page.locator("html")).not.toHaveAttribute("data-loading-flashed", "true");
    await client.page.unroute("**/workspace/**");
    for (const [tab, heading] of [["milestones", "Milestones"], ["files", "Shared files"], ["payments", "Payments"], ["contract", "Contract"]]) {
      await client.page.getByRole("link", { name: tab, exact: true }).click();
      await expect(client.page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(client.page.locator("html")).not.toHaveAttribute("data-shell-hidden", "true");
      await expect(client.page.locator("html")).not.toHaveAttribute("data-loading-flashed", "true");
    }
    await client.page
      .getByRole("button", { name: "Submit contract proposal", exact: true })
      .click();
    await client.page
      .getByRole("button", { name: "Approve contract version 1", exact: true })
      .click();
    await expect(
      client.page.getByText("No contract has been accepted yet.", {
        exact: false,
      }),
    ).toBeVisible();
    // The professional is still on their home page: the live bell must receive
    // the client's first approval without navigation or a manual refresh.
    await pro.page.getByRole("button", { name: /^Notifications/ }).click();
    const contractNotice = pro.page.getByRole("link", { name: "Client approved contract version 1", exact: true });
    await expect(contractNotice).toBeVisible();
    await expect(contractNotice).toHaveAttribute("href", /tab=contract&version=/);
    await contractNotice.click();
    await pro.page
      .getByRole("button", { name: "Approve contract version 1", exact: true })
      .click();
    await expect(
      pro.page.getByText("Accepted version 1", { exact: false }),
    ).toBeVisible();
    await client.page.getByRole("button", { name: /^Notifications/ }).click();
    await expect(client.page.getByRole("link", { name: "Professional approved contract version 1", exact: true })).toBeVisible();
    await client.page.getByRole("dialog", { name: "Notifications", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
    const contract = await client.db
      .from("engagement_contracts")
      .select("accepted_version_id")
      .eq("engagement_id", e)
      .single();
    expect(contract.error).toBeNull();
    const version = contract.data!.accepted_version_id;
    const secret = await client.db.rpc("post_discussion_message", {
      e,
      v: "client",
      b: "PRIVATE monitoring secret: do not share my negotiation limits.",
    });
    expect(secret.error).toBeNull();
    expect(
      (await pro.db.from("messages").select("id").eq("id", secret.data)).data,
    ).toHaveLength(0);
    expect(
      (
        await admin
          .from("message_assessments")
          .select("id")
          .eq("message_id", secret.data)
      ).data,
    ).toHaveLength(0);
    const context = await pro.db.rpc("search_agent_evidence", {
      e,
      v: "shared",
      q: "contract",
    });
    expect(context.error).toBeNull();
    expect(JSON.stringify(context.data)).not.toContain(
      "PRIVATE monitoring secret",
    );
    // The two pages remain in Contract. Post directly through the authenticated
    // RPC so the fixture can drive metering/result deterministically, without
    // executing OpenAI. Production posts schedule the worker with Next after().
    const root = await client.db.rpc("post_discussion_message",{e,v:"shared",b:"Let us discuss the next request in this thread."});
    expect(root.error).toBeNull();
    const rootJob=await admin.from("message_assessments").select("id").eq("message_id",root.data).single();
    expect((await admin.rpc("fail_message_assessment",{j:rootJob.data!.id,why:"fixture_no_provider"})).error).toBeNull();
    const message = await client.db.rpc("post_discussion_message", {
      e,
      v: "shared",
      b: "Could we also send scheduled email reports?",
      parent:root.data,
    });
    expect(message.error).toBeNull();
    const job = await admin
      .from("message_assessments")
      .select("id,terms")
      .eq("message_id", message.data)
      .single();
    expect(job.error).toBeNull();
    expect(JSON.stringify(job.data!.terms)).not.toContain("PRIVATE");
    const pricing = await admin
      .from("ai_pricing")
      .select("*")
      .eq("model", process.env.OPENAI_MODEL!)
      .eq("enabled", true)
      .order("effective_at", { ascending: false })
      .limit(1)
      .single();
    expect(pricing.error).toBeNull();
    const claim = await admin.rpc("claim_message_assessment", {
      j: job.data!.id,
      price: pricing.data!.id,
      budget: reservationBudget(pricing.data as Price).toString(),
    });
    expect(claim.error).toBeNull();
    expect(claim.data).toBeTruthy();
    expect(
      (
        await admin.rpc("record_usage", {
          op_id: claim.data,
          response_id: `synthetic-scope-${run}`,
          price: pricing.data!.id,
          inputs: 100,
          cached: 0,
          outputs: 20,
        })
      ).error,
    ).toBeNull();
    const payload = {
      isRequest: true,
      verdict: "potential_conflict",
      summary: "Email reports may add work excluded by the accepted contract.",
      issues: [
        {
          messageQuote: "scheduled email reports",
          termRef: `contract:${version}`,
          termQuote: "Scheduled email reports are excluded.",
          explanation:
            "This request differs from the accepted CSV-only scope. Review a contract or milestone revision together before committing.",
        },
      ],
    };
    expect(
      (
        await admin.rpc("finish_message_assessment", {
          j: job.data!.id,
          payload,
        })
      ).error,
    ).toBeNull();
    for (const actor of [client, pro]) {
      await actor.page.goto(`/workspace/${e}?tab=discussion`);
      await expect(
        actor.page.getByRole("heading", {
          name: "Potential scope or contract issue",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        actor.page
          .locator("mark")
          .filter({ hasText: "scheduled email reports" }),
      ).toBeVisible();
      await actor.page
        .getByText("Accepted term cited", { exact: true })
        .click();
      await expect(
        actor.page.getByRole("link", {
          name: "View accepted contract version",
          exact: true,
        }),
      ).toHaveAttribute(
        "href",
        `/workspace/${e}?tab=contract&version=${version}#contract-archive-${version}`,
      );
    }
    await pro.page.screenshot({
      path: "test-results/scope-notice-desktop.png",
      fullPage: true,
    });
    await pro.page.setViewportSize({ width: 390, height: 844 });
    await pro.page.screenshot({
      path: "test-results/scope-notice-mobile.png",
      fullPage: true,
    });
    expect(
      await pro.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await outsider.db
          .from("contract_versions")
          .select("id")
          .eq("engagement_id", e)
      ).data,
    ).toHaveLength(0);
    expect(
      (
        await outsider.db
          .from("message_assessments")
          .select("id")
          .eq("engagement_id", e)
      ).data,
    ).toHaveLength(0);
    await pro.page.goto(
      `/workspace/${e}?tab=contract&version=${version}#contract-archive-${version}`,
    );
    await expect(
      pro.page.locator(`#contract-archive-${version}`),
    ).toBeVisible();
    await pro.page
      .getByLabel("Contract text")
      .fill(body + " The client will anonymise example data.");
    await pro.page
      .getByRole("button", { name: "Submit contract proposal", exact: true })
      .click();
    await expect(
      pro.page.getByRole("heading", {
        name: "Proposed version 2",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (
        await client.db
          .from("engagement_contracts")
          .select("accepted_version_id")
          .eq("engagement_id", e)
          .single()
      ).data!.accepted_version_id,
    ).toBe(version);
    await pro.page
      .getByRole("button", { name: "Approve contract version 2", exact: true })
      .click();
    await client.page.goto(`/workspace/${e}?tab=contract`);
    await client.page
      .getByRole("button", { name: "Approve contract version 2", exact: true })
      .click();
    await expect(
      client.page.getByText("Accepted version 2", { exact: false }),
    ).toBeVisible();
    await pro.page.goto(`/workspace/${e}?tab=contract&version=${version}`);
    await expect(
      pro.page.getByText(/Version 1 · previously accepted/),
    ).toBeVisible();
    await pro.page
      .getByRole("button", {
        name: "Pause future automatic checks",
        exact: true,
      })
      .click();
    await expect(
      pro.page.getByRole("button", {
        name: "Enable future automatic checks",
        exact: true,
      }),
    ).toBeVisible();
    await pro.page.screenshot({
      path: "test-results/contract-mobile.png",
      fullPage: true,
    });
    await pro.page.setViewportSize({ width: 1280, height: 800 });
    await pro.page.screenshot({
      path: "test-results/contract-desktop.png",
      fullPage: true,
    });
  } finally {
    for (const context of contexts) await context.close();
    await cleanupIntegrationRun(run, admin);
  }
});

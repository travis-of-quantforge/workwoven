import { test, expect, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import fs from "node:fs";
import { cleanupIntegrationRun } from "../../scripts/integration-fixtures.mjs";

test("shared conversation findings, evidence, resolution and participant dismissal (deterministic model fixture)", async ({
  browser,
}) => {
  const run = randomUUID(),
    password = randomBytes(24).toString("base64url") + "aA1!";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
    options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, options),
    contexts: BrowserContext[] = [];
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
      return { email, db, page };
    }
    const client = await actor("client"),
      pro = await actor("professional");
    const created = await client.db.rpc("create_engagement", {
      p_title: `[E2E] Conversation ${run}`,
    });
    expect(created.error).toBeNull();
    const e = created.data;
    const invite = await client.db.rpc("create_invitation", {
      e,
      target_email: pro.email,
    });
    expect(invite.error).toBeNull();
    expect(
      (await pro.db.rpc("accept_invitation", { t: invite.data })).error,
    ).toBeNull();
    const secret = await client.db.rpc("post_discussion_message", {
      e,
      v: "client",
      b: "PRIVATE marker not for shared review",
    });
    expect(secret.error).toBeNull();
    const source = await client.db.rpc("post_discussion_message", {
      e,
      v: "shared",
      b: "Make it easy to update.",
    });
    expect(source.error).toBeNull();
    const price = (
      await admin
        .from("ai_pricing")
        .select("id")
        .eq("enabled", true)
        .limit(1)
        .single()
    ).data!.id;
    async function finish(message: string, findings: unknown[]) {
      const job = await admin
        .from("message_assessments")
        .select("id")
        .eq("message_id", message)
        .single();
      expect(job.error).toBeNull();
      const prepared = await admin.rpc("prepare_conversation_review", {
        j: job.data!.id,
      });
      expect(prepared.error).toBeNull();
      expect(JSON.stringify(prepared.data)).not.toContain("PRIVATE marker");
      const claim = await admin.rpc("claim_message_assessment", {
        j: job.data!.id,
        price,
        budget: 1000000,
      });
      expect(claim.error).toBeNull();
      expect(claim.data).toBeTruthy();
      expect(
        (
          await admin.rpc("record_usage", {
            op_id: claim.data,
            response_id: `fixture-review-${randomUUID()}`,
            price,
            inputs: 100,
            cached: 0,
            outputs: 20,
          })
        ).error,
      ).toBeNull();
      const payload = {
        summary: "Labelled deterministic conversation review fixture",
        coverage: "complete",
        findings,
      };
      expect(
        (
          await admin.rpc("finish_conversation_review", {
            j: job.data!.id,
            payload,
          })
        ).error,
      ).toBeNull();
      expect(
        (
          await admin.rpc("finish_conversation_review", {
            j: job.data!.id,
            payload,
          })
        ).error,
      ).toBeNull();
    }
    const finding = {
      existingId: null,
      subject: "content editing",
      reopenReason: null,
      actionable: true,
      categories: ["ambiguity", "understanding"],
      explanation:
        "Updates could mean self-service editing or changes by the professional.",
      nextStep: "Should the client edit content through an admin interface?",
      references: [
        {
          ref: `message:${source.data}`,
          version: "1",
          quote: "easy to update",
        },
      ],
      status: "awaiting_clarification",
      respondent: "client",
      reminderReason: null,
      questionRef: null,
      resolutionReferences: [],
    };
    await finish(source.data, [finding]);
    await pro.page.goto(`/workspace/${e}?tab=discussion`);
    const panel = pro.page.getByRole("region", { name: "Conversation checks" });
    await expect(
      pro.page.getByRole("button", { name: "Review discussion", exact: true }),
    ).toBeVisible();
    await pro.page.locator("#conversation-checks > details > summary").click();
    const stored = await admin
      .from("conversation_findings")
      .select("id")
      .eq("engagement_id", e)
      .single();
    expect(stored.error).toBeNull();
    const card = pro.page.locator(`#finding-${stored.data!.id}`);
    await expect(card).toContainText("self-service editing");
    await card.getByText("Evidence", { exact: true }).click();
    await expect(
      card.getByRole("link", { name: "View source · version 1", exact: true }),
    ).toHaveAttribute("href", new RegExp(`message=${source.data}`));
    await card
      .getByRole("link", { name: "View source · version 1", exact: true })
      .click();
    await expect(pro.page.locator(`#message-${source.data}`)).toBeVisible();
    await pro.page.goto("/"); // Keep the AI-disabled worker separate from synthetic publication.
    const answer = await client.db.rpc("post_discussion_message", {
      e,
      v: "shared",
      b: "I will edit content myself through an admin interface.",
    });
    expect(answer.error).toBeNull();
    await finish(answer.data, [
      {
        ...finding,
        existingId: stored.data!.id,
        status: "resolved",
        actionable: false,
        explanation: "Self-service editing was clarified.",
        resolutionReferences: [
          {
            ref: `message:${answer.data}`,
            version: "1",
            quote: "I will edit content myself",
          },
        ],
      },
    ]);
    await pro.page.goto(`/workspace/${e}?tab=discussion`);
    await pro.page.locator("#conversation-checks > details > summary").click();
    await expect(card).toContainText("resolved");
    // A second independent issue tests participant dismissal rather than model resolution.
    await pro.page.goto("/");
    const paymentMessage = await client.db.rpc("post_discussion_message", {
      e,
      v: "shared",
      b: "I paid outside the platform, but the professional says it has not arrived.",
    });
    expect(paymentMessage.error).toBeNull();
    await finish(paymentMessage.data, [
      {
        ...finding,
        subject: "external payment verification",
        categories: ["mediation"],
        references: [
          {
            ref: `message:${paymentMessage.data}`,
            version: "1",
            quote: "I paid outside the platform",
          },
        ],
        explanation:
          "The client reports an external payment; the professional reports non-receipt. There is no provider confirmation in the shared record.",
        nextStep:
          "Please share the transfer reference and confirm the recipient before drawing conclusions.",
      },
    ]);
    await client.page.goto(`/workspace/${e}?tab=discussion`);
    await client.page
      .locator("#conversation-checks > details > summary")
      .click();
    const active = client.page
      .locator("#conversation-checks article")
      .filter({ hasText: "external payment" });
    await expect(active).toContainText("no provider confirmation");
    await active
      .getByPlaceholder("Optional feedback")
      .fill("We will check the external reference ourselves.");
    await active.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(active).toContainText("dismissed");
    await expect(active).toContainText("commitments are unchanged");
    await client.page.setViewportSize({ width: 390, height: 844 });
    expect(
      await client.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await client.page.screenshot({
      path: "test-results/conversation-checks-mobile.png",
      fullPage: true,
    });
    // No model/provider calls were used; normal manual review still queues safely with AI disabled.
    await client.page
      .getByRole("button", { name: "Review discussion", exact: true })
      .click();
    await expect(client.page.locator("#conversation-checks")).toContainText(
      /Review unavailable|Review pending|Latest review completed/,
    );
    expect(panel).toBeTruthy();
  } finally {
    for (const context of contexts) await context.close();
    await cleanupIntegrationRun(run, admin);
  }
});

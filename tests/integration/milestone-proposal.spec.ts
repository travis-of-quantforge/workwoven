import { test, expect, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import fs from "node:fs";
import { cleanupIntegrationRun } from "../../scripts/integration-fixtures.mjs";

test("Discussion milestone modal, two-party approval, revision and professional rate", async ({
  browser,
}) => {
  test.setTimeout(240000);
  test.skip(
    !process.env.SUPABASE_DB_URL || !process.env.SUPABASE_SECRET_KEY,
    "Requires development Supabase",
  );
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = createClient(url, process.env.SUPABASE_SECRET_KEY!, options);
  const run = randomUUID();
  fs.mkdirSync(".integration-runs", { recursive: true });
  fs.writeFileSync(`.integration-runs/${run}.json`, JSON.stringify({ run }));
  const password = randomBytes(24).toString("base64url") + "aA1!";
  const contexts: BrowserContext[] = [];
  try {
    async function fixture(role: string) {
      const email = `workspace-e2e-${run}-${role}@example.test`;
      const generated = await service.auth.admin.generateLink({
        type: "signup",
        email,
        password,
        options: {
          data: {
            workspace_test_run: run,
            profile_type: role,
            hourly_rate_cents: role === "professional" ? 5000 : null,
          },
        },
      });
      if (generated.error) throw new Error("Fixture signup failed");
      const db = createClient(
        url,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        options,
      );
      const verified = await db.auth.verifyOtp({
        token_hash: generated.data.properties.hashed_token,
        type: "signup",
      });
      if (verified.error) throw new Error("Fixture verification failed");
      return { email, db };
    }
    const client = await fixture("client");
    const professional = await fixture("professional");
    const created = await client.db.rpc("create_engagement", {
      p_title: `[E2E] Milestone modal ${run}`,
      p_role: "client",
    });
    if (created.error) throw new Error(created.error.message);
    const e = created.data;
    const invitation = await client.db.rpc("create_invitation", {
      e,
      target_email: professional.email,
    });
    const joined = await professional.db.rpc("accept_invitation", {
      t: invitation.data,
    });
    if (invitation.error || joined.error)
      throw new Error("Fixture invitation failed");
    async function pageFor(email: string) {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL("http://127.0.0.1:3200/");
      return page;
    }
    const cp = await pageFor(client.email);
    const pp = await pageFor(professional.email);
    await pp.goto("/profile");
    await pp.getByLabel("Display name").fill("Demo professional");
    await pp.getByLabel("Professional hourly rate (USD)").fill("65");
    await pp
      .getByRole("button", { name: "Save profile" })
      .click();
    await expect(pp.getByRole("status")).toContainText("Saved");
    expect((await client.db.rpc("engagement_hourly_rate", { e })).data).toBe(
      6500,
    );
    // Synthetic saved agent exchange; no model request or provider expense.
    const actor = (await client.db.auth.getUser()).data.user!.id;
    const pricing = await service
      .from("ai_pricing")
      .select("id")
      .eq("model", "gpt-5-mini-2025-08-07")
      .eq("enabled", true)
      .single();
    if (pricing.error) throw new Error("Fixture pricing unavailable");
    const runId = await service.rpc("begin_agent_run", {
      e,
      v: "shared",
      actor,
      question: "Fixture milestone drafting request",
      k: randomUUID(),
      budget: "100000000",
      price: pricing.data.id,
      hash: `fixture-${run}`,
    });
    if (runId.error) throw new Error(runId.error.message);
    const agentResult = {
      kind: "milestones",
      answer: "Fixture project-agent milestone advice",
      citations: [],
      questions: [],
      proposal: null,
      summary: null,
      milestones: [
        { description: "Fixture AI description of the CSV dashboard" },
      ],
    };
    const metered = await service.rpc("record_usage", { op_id: runId.data, response_id: `fixture-no-provider-${run}`, price: pricing.data.id, inputs: 0, cached: 0, outputs: 0 });
    if (metered.error) throw new Error(metered.error.message);
    const finished = await service.rpc("finish_agent_run", {
      op: runId.data,
      payload: agentResult,
      body: agentResult.answer,
      outcome: "success",
    });
    if (finished.error) throw new Error(finished.error.message);
    await cp.goto(`/workspace/${e}?tab=discussion`);
    await expect(
      cp.getByRole("link", { name: "milestones", exact: true }),
    ).toHaveCount(1);
    await expect(
      cp.getByRole("heading", { name: "Project Agent" }),
    ).toBeHidden();
    await expect(
      cp
        .locator("article")
        .filter({ hasText: "Fixture project-agent milestone advice" }),
    ).toBeHidden();
    await cp.getByRole("link", { name:"Project agent", exact: true }).click();
    await expect(
      cp.getByRole("heading", { name: "Project Agent" }),
    ).toBeVisible();
    const agentHistory = cp.getByLabel("Agent chat history");
    await expect(
      agentHistory.getByText("Fixture milestone drafting request", {
        exact: true,
      }),
    ).toBeVisible();
    const agentText = agentHistory.getByText(
      "Fixture project-agent milestone advice",
      { exact: true },
    );
    await expect(agentText).toBeVisible();
    await expect(agentText).toHaveCSS("color", "rgb(30, 58, 138)");
    await expect(
      agentHistory.getByText("Fixture AI description of the CSV dashboard", {
        exact: true,
      }),
    ).toHaveCSS("color", "rgb(30, 58, 138)");
    const stored = await service
      .from("agent_runs")
      .select("output_message_id")
      .eq("id", runId.data)
      .single();
    await cp.goto(
      `/workspace/${e}?tab=discussion&message=${stored.data!.output_message_id}#message-${stored.data!.output_message_id}`,
    );
    await expect(
      cp
        .getByLabel("Agent chat history")
        .getByText("Fixture project-agent milestone advice", { exact: true }),
    ).toBeVisible();
    await cp.getByRole("link",{name:"Shared workspace",exact:true}).click();
    await cp
      .getByRole("button", { name: "Propose milestones", exact: true })
      .click();
    const modal = cp.getByRole("dialog", { name: "Propose milestones" });
    await expect(modal.getByLabel("Description", { exact: true })).toHaveCount(
      1,
    );
    await expect(
      modal.getByRole("button", { name: "Create milestones from discussion" }),
    ).toBeDisabled();
    await modal
      .getByLabel("Description", { exact: true })
      .fill("Build the CSV reporting dashboard and reconcile regional totals.");
    await modal.getByLabel("Acceptance criteria", { exact: true }).fill("Totals reconcile with the supplied CSV and region filters work.");
    await modal.getByLabel("Client responsibilities (optional)").fill("Supply the example CSV.");
    await modal.getByLabel("Amount on completion (USD)").fill("100");
    await modal.getByLabel("Target deadline").fill("2026-12-15");
    await modal
      .getByRole("button", { name: "Add milestone", exact: true })
      .click();
    await modal
      .getByLabel("Description", { exact: true })
      .nth(1)
      .fill("Deliver the handover guide and run a review call.");
    await modal.getByLabel("Acceptance criteria", { exact: true }).nth(1).fill("Guide explains dashboard upload and review steps.");
    await modal.getByLabel("Amount on completion (USD)").nth(1).fill("200");
    await modal.getByLabel("Target deadline").nth(1).fill("2026-12-20");
    await modal.evaluate((element) => {
      element.scrollTop = 0;
    });
    await cp.screenshot({
      path: "test-results/milestone-modal-desktop.png",
    });
    await cp.setViewportSize({ width: 390, height: 844 });
    await modal.evaluate((element) => {
      element.scrollTop = 0;
    });
    expect(
      await cp.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await cp.screenshot({
      path: "test-results/milestone-modal-mobile.png",
    });
    await cp.setViewportSize({ width: 1280, height: 900 });
    await modal
      .getByRole("button", { name: "Submit and approve proposals" })
      .click();
    await expect(modal).toHaveCount(0);
    const discussion = cp.locator("article").filter({ hasText: "Milestone proposed" });
    await expect(discussion).toHaveCount(2);
    await expect(cp.getByText("Milestone agreement versions", { exact: true })).toHaveCount(0);
    await discussion.first().getByRole("link", { name: /View milestone/ }).click();
    await expect(cp.getByRole("dialog", { name: "Milestone version history" })).toBeVisible();
    await cp.getByRole("button", { name: "Close archive" }).click();
    const proposed = await service.from("milestones").select("id,latest_version_id,accepted_version_id").eq("engagement_id", e).order("created_at").order("id");
    expect(proposed.data).toHaveLength(2);
    expect(proposed.data!.every(m => !m.accepted_version_id)).toBe(true);
    const m = proposed.data![0], other = proposed.data![1];
    await pp.goto(`/workspace/${e}?tab=milestones`);
    const receiverCard = pp.locator(`#milestone-${m.id}`);
    await expect(pp.locator("[data-active=true]")).toHaveCount(0);
    await expect(receiverCard.locator(":scope > details")).not.toHaveAttribute("open", "");
    await receiverCard.locator(":scope > details > summary").click();
    await receiverCard.getByRole("button", { name: "Accept version 1", exact: true }).click();
    await expect(receiverCard).toHaveAttribute("data-active", "true");
    await expect(receiverCard).toHaveCSS("border-top-width", "2px");
    await expect(receiverCard).toHaveCSS("border-top-color", "rgb(8, 127, 120)");
    await expect(receiverCard.locator(":scope > details")).toHaveAttribute("open", "");
    await expect(receiverCard.getByText("Active", { exact: true })).toBeVisible();
    await expect(pp.locator(`#milestone-${other.id} > details`)).not.toHaveAttribute("open", "");
    await expect(receiverCard.getByRole("button", { name: "Accept version 1", exact: true })).toHaveCount(0);
    expect((await service.from("milestones").select("accepted_version_id").eq("id", m.id).single()).data!.accepted_version_id).toBe(m.latest_version_id);
    expect((await service.from("milestones").select("accepted_version_id").eq("id", other.id).single()).data!.accepted_version_id).toBeNull();
    await cp.getByRole("button", { name: /^Notifications/ }).click();
    const milestoneNotice = cp.getByRole("link", { name: /^Professional approved milestone version 1:/ });
    await expect(milestoneNotice).toHaveCount(1);
    await expect(milestoneNotice).toHaveAttribute("href", `/workspace/${e}?tab=milestones&version=${m.latest_version_id}`);
    await milestoneNotice.click();
    await expect(cp.getByRole("dialog", { name: "Milestone version history" })).toBeVisible();
    await cp.getByRole("button", { name: "Close archive" }).click();
    await receiverCard.getByRole("button", { name: "Propose amendment" }).click();
    const amendment = pp.getByRole("dialog", { name: "Propose amendment" });
    await amendment.getByLabel("Amount on completion (USD)").fill("125");
    await amendment.getByLabel("Reason for revision").fill("Include additional reconciliation of the supplied CSV.");
    await amendment.getByRole("button", { name: "Submit and approve amendment" }).click();
    await expect(amendment).toHaveCount(0);
    const changed = await service.from("milestones").select("latest_version_id,accepted_version_id").eq("id", m.id).single();
    expect(changed.data!.accepted_version_id).toBe(m.latest_version_id);
    expect(changed.data!.latest_version_id).not.toBe(m.latest_version_id);
    await cp.goto(`/workspace/${e}?tab=milestones`);
    const authorCard = cp.locator(`#milestone-${m.id}`);
    await expect(authorCard.getByText("Pending amendment · version 2")).toBeVisible();
    await authorCard.getByRole("button", { name: "Accept version 2", exact: true }).click();
    await expect(authorCard.getByText("Pending amendment · version 2")).toHaveCount(0);
    await authorCard.getByRole("button", { name: "Propose revision" }).click();
    const revision = cp.getByRole("dialog", { name: "Propose revision" });
    await revision.getByLabel("Target deadline").fill("2026-12-29");
    await revision.getByLabel("Reason for revision").fill("Move the review deadline by mutual agreement.");
    await revision.getByRole("button", { name: "Submit and approve revision" }).click();
    await expect(revision).toHaveCount(0);
    await authorCard.getByRole("button", { name: "Archive · 3 versions" }).click();
    const archive = cp.getByRole("dialog", { name: "Milestone version history" });
    await expect(archive.getByRole("heading", { name: "Version 1 · Previously accepted" })).toBeVisible();
    await expect(archive.getByRole("heading", { name: "Version 2 · Accepted" })).toBeVisible();
    await expect(archive.getByRole("heading", { name: "Version 3 · Proposed" })).toBeVisible();
    await expect(archive.getByRole("button", { name: /Accept version/ })).toHaveCount(0);
    await cp.setViewportSize({ width: 390, height: 844 });
    expect(await cp.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await cp.screenshot({ path: "test-results/milestone-archive-mobile.png" });
    await archive.getByRole("button", { name: "Close archive" }).click();
    await cp.screenshot({ path: "test-results/milestones-mobile.png", fullPage: true });
    await cp.setViewportSize({ width: 1280, height: 900 });
    await cp.screenshot({ path: "test-results/milestones-desktop.png", fullPage: true });
    await cp.goto(`/workspace/${e}?tab=discussion`);
    await expect(cp.locator("article").filter({ hasText: "Milestone proposed" })).toHaveCount(4);
    await expect(cp.locator("article").filter({ hasText: "Milestone accepted" })).toHaveCount(2);
    const preview = cp.getByRole("region", { name: "Active milestone", exact: true });
    await expect(preview).toContainText("Version 2");
    const previewLink = preview.getByRole("link", { name: "View milestone", exact: true });
    await expect(previewLink).toHaveAttribute("href", `/workspace/${e}?tab=milestones#milestone-${m.id}`);
    const previewBounds = await preview.boundingBox();
    const proposeBounds = await cp.getByRole("button", { name: "Propose milestones", exact: true }).boundingBox();
    expect(previewBounds!.y + previewBounds!.height).toBeLessThanOrEqual(proposeBounds!.y);
    await previewLink.click();
    await expect(cp.locator(`#milestone-${m.id}`)).toHaveAttribute("data-active", "true");

    // Active follows the accepted deadline, then advances only after client
    // acceptance of delivery; neither a proposal nor a payment completes it.
    expect((await professional.db.rpc("accept_milestone", { v: other.latest_version_id })).error).toBeNull();
    const acceptedItems = await service.from("milestones").select("id,accepted_version_id").eq("engagement_id", e);
    const acceptedVersions = await service.from("milestone_versions").select("id,task_id").in("id", acceptedItems.data!.map(row => row.accepted_version_id));
    const acceptedTasks = await service.from("milestone_tasks").select("id,end_date").in("id", acceptedVersions.data!.map(row => row.task_id));
    const ordered = acceptedItems.data!.map(item => ({
      id: item.id,
      task: acceptedTasks.data!.find(task => task.id === acceptedVersions.data!.find(v => v.id === item.accepted_version_id)!.task_id)!,
    })).sort((a, b) => a.task.end_date.localeCompare(b.task.end_date));
    await cp.goto(`/workspace/${e}?tab=milestones`);
    for (let index = 0; index < ordered.length; index++) {
      const current = ordered[index];
      await expect(cp.locator(`#milestone-${current.id}`)).toHaveAttribute("data-active", "true");
      await expect(cp.locator(`#milestone-${current.id} > details`)).toHaveAttribute("open", "");
      let submitted;
      if (index === 0) {
        await pp.goto(`/workspace/${e}?tab=milestones`);
        const card = pp.locator(`#milestone-${current.id}`);
        await card.getByText("Delivery and progress", { exact: true }).click();
        await card.getByText("Submit formal delivery", { exact: true }).click();
        await card.getByLabel("Delivery message", { exact: true }).fill("Deliver the agreed dashboard files for review.");
        await card.getByLabel("Upload a delivery file (optional)", { exact: true }).setInputFiles({name:"invalid.png",mimeType:"image/png",buffer:Buffer.from("not a PNG")});
        await card.getByRole("button", { name:"Submit delivery for review",exact:true }).click();
        await expect(card.getByRole("alert")).toContainText("valid PNG signature");
        expect((await service.from("delivery_submissions").select("id").eq("task_id",current.task.id)).data).toHaveLength(0);
        await card.getByLabel("Delivery message", { exact: true }).fill("Deliver the agreed dashboard files for review.");
        await card.getByLabel("Upload a delivery file (optional)", { exact: true }).setInputFiles({name:"dashboard-delivery.txt",mimeType:"text/plain",buffer:Buffer.from("Regional CSV totals reconcile with the supplied example data.\nReview the upload and filtering checklist.")});
        await card.getByRole("button", { name:"Submit delivery for review",exact:true }).click();
        await expect(card.getByRole("link",{name:"dashboard-delivery.txt",exact:true})).toBeVisible();
        const saved = await service.from("delivery_submissions").select("id").eq("task_id",current.task.id).single();
        expect(saved.error).toBeNull();
        submitted = { data:saved.data!.id,error:null };
        const attached = await service.from("delivery_files").select("attachment_id").eq("submission_id",submitted.data);
        expect(attached.data).toHaveLength(1);
        const metadata = await client.db.from("attachments").select("name,upload_status,source_message_id").eq("id",attached.data![0].attachment_id).single();
        expect(metadata.data?.name).toBe("dashboard-delivery.txt");
        expect(metadata.data?.upload_status).toBe("ready");
        expect(metadata.data?.source_message_id).toBeTruthy();
        await pp.screenshot({path:"test-results/delivery-upload-desktop.png",fullPage:true});
        await pp.setViewportSize({width:390,height:844});
        expect(await pp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await pp.screenshot({path:"test-results/delivery-upload-mobile.png",fullPage:true});
      } else {
        submitted = await professional.db.rpc("submit_delivery", { t: current.task.id, b: "Deliver the agreed work for review against its criteria.", links: [], files: [], k: randomUUID() });
      }
      expect(submitted.error).toBeNull();
      await expect(cp.locator(`#milestone-${current.id}`)).toHaveAttribute("data-active", "true");
      expect((await client.db.rpc("review_delivery", { s: submitted.data, decision: "accepted", reason: "The delivered work meets the agreed acceptance criteria." })).error).toBeNull();
      await expect(cp.locator(`#milestone-${current.id}`)).not.toHaveAttribute("data-active", "true");
      await expect(cp.locator(`#milestone-${current.id} > details`)).not.toHaveAttribute("open", "");
      await expect(cp.locator(`#milestone-${current.id} > details > summary`).getByText("Completed", { exact: true })).toBeVisible();
    }
    await expect(cp.locator("[data-active=true]")).toHaveCount(0);
    await cp.goto(`/workspace/${e}?tab=discussion`);
    await expect(cp.getByRole("region", { name: "Active milestone", exact: true })).toContainText("No active milestone.");

  } finally {
    for (const context of contexts) await context.close();
    await cleanupIntegrationRun(run, service);
  }
});

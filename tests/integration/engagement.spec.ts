import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import fs from "node:fs";
import { cleanupIntegrationRun } from "../../scripts/integration-fixtures.mjs";

const pendingRuns = new Set<string>();
test.afterEach(async () => {
  if (!pendingRuns.size) return;
  test.setTimeout(60000);
  const admin = createClient(projectUrl, secretKey, options);
  for (const run of pendingRuns) {
    await cleanupIntegrationRun(run, admin);
    pendingRuns.delete(run);
  }
});

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(20000) }),
  },
};
function checked<
  T extends { data: unknown; error: { message: string; code?: string } | null },
>(result: T, label: string): NonNullable<T["data"]> {
  if (result.error || result.data === null)
    throw new Error(
      label + " failed (" + (result.error?.code || "provider error") + ")",
    );
  return result.data as NonNullable<T["data"]>;
}

test("two authenticated parties: grant, invite, private isolation, threads, file, scope and revision", async ({
  browser,
}) => {
  test.setTimeout(600000);
  test.skip(
    !projectUrl || !publicKey || !secretKey || !process.env.SUPABASE_DB_URL,
    "Requires configured development Supabase and database credentials",
  );
  const admin = createClient(projectUrl, secretKey, options);
  const run = randomUUID();
  pendingRuns.add(run);
  fs.mkdirSync(".integration-runs", { recursive: true });
  fs.writeFileSync(`.integration-runs/${run}.json`, JSON.stringify({ run }));
  const password = randomBytes(24).toString("base64url") + "aA1!";
  const actors: { id: string; email: string; db: SupabaseClient }[] = [];
  const contexts = [];
  async function actor(side: string) {
    const email = `workspace-e2e-${run}-${side}@example.test`;
    const generated = checked(
      await admin.auth.admin.generateLink({
        type: "signup",
        email,
        password,
        options: { data: { workspace_test_run: run, profile_type: side === "professional" ? "professional" : "client" } },
      }),
      "Generate local verification fixture",
    );
    if (!generated.user || !generated.properties)
      throw new Error("Fixture user unavailable");
    const db = createClient(projectUrl, publicKey, options);
    const person = { id: generated.user.id, email, db };
    actors.push(person);
    const unverified = await db.auth.signInWithPassword({ email, password });
    expect(unverified.error?.code).toBe("email_not_confirmed");
    expect(
      (
        await db.rpc("create_engagement", {
          p_title: "[E2E] Unverified blocked " + run,
          p_role: "client",
        })
      ).error,
    ).not.toBeNull();
    const verified = checked(
      await db.auth.verifyOtp({
        token_hash: generated.properties.hashed_token,
        type: "signup",
      }),
      "Confirm fixture",
    );
    expect(verified.user?.email_confirmed_at).toBeTruthy();
    return person;
  }
  async function signIn(page: Page, email: string) {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("http://127.0.0.1:3200/");
  }
  async function send(page: Page, body: string) {
    await page.getByLabel("Message", { exact: true }).fill(body);
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.getByText(body, { exact: true })).toBeVisible();
  }
  async function fillScope(page: Page, emailReports = false) {
    await page.getByRole("button", { name: emailReports ? "Propose amendment" : "Propose milestones", exact: true }).click();
    const modal = page.getByRole("dialog");
    await modal.getByLabel("Description", { exact: true }).fill(emailReports ? "Dashboard and weekly reports" : "Reporting dashboard with CSV import and region/date filters.");
    await modal.getByLabel("Acceptance criteria", { exact: true }).fill("CSV totals reconcile and the weekly report includes the same totals.");
    await modal.getByLabel("Client responsibilities (optional)").fill("Supply representative data and review the dashboard.");
    await modal.getByLabel("Amount on completion (USD)").fill(emailReports ? "1200.00" : "1000.00");
    await modal.getByLabel("Target deadline").fill("2026-12-18");
    if (emailReports) await modal.getByLabel("Reason for revision").fill("Add scheduled reports after the original agreement.");
    await modal.getByRole("button", { name: emailReports ? "Submit and approve amendment" : "Submit and approve proposals", exact: true }).click();
    await expect(modal).toHaveCount(0);
  }
  try {
    const client = await actor("client");
    const professional = await actor("professional");
    const outsider = await actor("outsider");
    const clientContext = await browser.newContext();
    contexts.push(clientContext);
    const proContext = await browser.newContext();
    contexts.push(proContext);
    const cp = await clientContext.newPage(),
      pp = await proContext.newPage();
    await signIn(cp, client.email);
    await signIn(pp, professional.email);
    const title = "[E2E] Reporting dashboard " + run.slice(0, 8);
    await cp.getByLabel("Engagement name").fill(title);
    await cp
      .getByRole("button", { name: "Create engagement", exact: true })
      .click();
    await expect(
      cp.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    const e = cp.url().split("/workspace/")[1].split("?")[0];
    checked(
      await admin
        .from("engagements")
        .update({ is_demo: true })
        .eq("id", e)
        .select("id"),
      "Label hosted fixture as demo",
    );
    expect(
      checked(
        await client.db.from("starter_grants").select("engagement_id"),
        "Read grant",
      ),
    ).toHaveLength(1);
    const balances = checked(
      await client.db
        .from("agent_accounts")
        .select("visibility,available_nano")
        .eq("engagement_id", e),
      "Read balances",
    );
    expect(
      balances.find((a) => a.visibility === "shared")?.available_nano,
    ).toBe(5000000000);
    expect(
      balances.find((a) => a.visibility === "client")?.available_nano,
    ).toBe(0);
    await cp
      .getByRole("link", { name: "Your private assistant", exact: true })
      .click();
    // Historical private notes/files remain readable in the central assistant;
    // new assistant messages use the separately tested metered agent endpoint.
    await expect(cp.getByLabel("Message your private assistant",{exact:true})).toBeVisible();
    checked(await client.db.rpc("post_discussion_message", {e,v:"client",b:"PRIVATE FIXTURE: internal budget ceiling must remain confidential."}), "Private historical note");
    const privateBytes = Buffer.from("PRIVATE FIXTURE: internal planning notes.");
    const privatePath = checked(await client.db.rpc("register_attachment", {e,v:"client",n:"private-planning.txt",mime:"text/plain",bytes:privateBytes.length}), "Register private fixture file");
    checked(await client.db.storage.from("engagement-files").upload(privatePath,privateBytes,{contentType:"text/plain",upsert:false}), "Upload private fixture file");
    checked(await client.db.rpc("confirm_attachment_with_message", {p:privatePath,b:"Private planning file for this engagement.",parent:null,mentions:[]}), "Confirm private fixture file");
    expect((await admin.rpc("store_attachment_text", {p:privatePath,actor:client.id,body:privateBytes.toString("utf8"),hash:createHash("sha256").update(privateBytes).digest("hex"),is_complete:true})).error).toBeNull();
    await cp.reload();
    await expect(cp.getByText("PRIVATE FIXTURE: internal budget ceiling must remain confidential.",{exact:true})).toBeVisible();
    await expect(cp.getByRole("link", {name:"Open attachment: private-planning.txt",exact:true})).toBeVisible();
    await cp.getByLabel("Message your private assistant",{exact:true}).fill("UNSENT PRIVATE AGENT question");
    await cp
      .getByRole("link", { name: "Shared workspace", exact: true })
      .click();
    await expect(
      cp.getByLabel("Message", { exact: true }),
    ).toHaveValue("");
    await expect(cp.getByRole("heading", { name: "Project Agent" })).toBeHidden();
    await cp.getByText("Chat with the project agent", { exact: true }).click();
    await expect(cp.getByLabel("Your question", { exact: true })).toHaveValue(
      "",
    );
    await expect(
      cp.getByRole("button", { name: "Send", exact: true }),
    ).toBeDisabled();
    await expect(cp.getByRole("heading", { name: "Project Agent" })).toBeVisible();
    await expect(cp.getByText("Both parties can read this interaction.")).toBeVisible();
    await expect(cp.getByLabel("Help with")).toHaveCount(0);
    await expect(cp.getByText("Manage this agent’s tokens")).toHaveCount(0);
    const pausedAI = await cp.request.post("/api/agents", {
      headers: { origin: "http://127.0.0.1:3200" },
      data: {},
    });
    expect(pausedAI.status()).toBe(503);
    expect(
      (
        await cp.request.post("/api/agents", {
          headers: { origin: "https://untrusted.example" },
          data: {},
        })
      ).status(),
    ).toBe(403);
    expect((await cp.request.post("/api/maintenance")).status()).toBe(401);
    await send(cp, "We need weekly regional revenue totals from a CSV export.");
    await cp.getByLabel("Their email").fill(professional.email);
    await cp
      .getByRole("button", { name: "Send invitation", exact: true })
      .click();
    await expect(cp).toHaveURL(/invite=/);
    const inviteToken = new URL(cp.url()).searchParams.get("invite")!;
    await expect(cp.getByLabel("Their email")).toHaveCount(0);
    await expect(cp.getByRole("button", { name: "Send invitation" })).toHaveCount(0);
    const wrong = await outsider.db.rpc("accept_invitation", {
      t: inviteToken,
    });
    expect(wrong.error).not.toBeNull();
    await pp.goto("/");
    const pendingInvites = pp.getByRole("region", { name: "Pending invitations" });
    await expect(pendingInvites).toBeVisible();
    await expect(cp.getByRole("region", { name: "Pending invitations" })).toHaveCount(0);
    await pendingInvites
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click();
    await expect(pp).toHaveURL("http://127.0.0.1:3200/workspace/" + e);
    expect(
      checked(
        await professional.db.from("starter_grants").select("engagement_id"),
        "Invitee grant query",
      ),
    ).toHaveLength(0);
    const replay = await professional.db.rpc("accept_invitation", {
      t: inviteToken,
    });
    expect(replay.error).not.toBeNull();
    await cp.goto("/workspace/" + e);
    await expect(
      cp.getByText("Both parties joined", { exact: false }),
    ).toBeVisible();
    await expect(
      pp.getByText(
        "PRIVATE FIXTURE: internal budget ceiling must remain confidential.",
      ),
    ).toHaveCount(0);
    const privateRows = checked(
      await professional.db
        .from("messages")
        .select("id")
        .eq("engagement_id", e)
        .eq("visibility", "client"),
      "Private message isolation",
    );
    expect(privateRows).toEqual([]);
    expect(
      checked(
        await professional.db
          .from("agent_accounts")
          .select("id")
          .eq("engagement_id", e)
          .eq("visibility", "client"),
        "Private balance isolation",
      ),
    ).toEqual([]);
    expect(
      checked(
        await outsider.db.from("engagements").select("id").eq("id", e),
        "Outsider isolation",
      ),
    ).toEqual([]);
    const privateFile = checked(
      await client.db
        .from("attachments")
        .select("id,object_path")
        .eq("engagement_id", e)
        .eq("visibility", "client")
        .single(),
      "Private file fixture",
    );
    expect(
      checked(
        await professional.db
          .from("attachments")
          .select("id")
          .eq("object_path", privateFile.object_path),
        "Private file metadata isolation",
      ),
    ).toEqual([]);
    const extractedPrivate = checked(
      await client.db
        .from("attachment_texts")
        .select("attachment_id,content")
        .eq("attachment_id", privateFile.id),
      "Own extracted text",
    );
    expect(extractedPrivate[0]?.content).toContain("PRIVATE FIXTURE");
    expect(
      checked(
        await professional.db
          .from("attachment_texts")
          .select("*")
          .eq("attachment_id", privateFile.id),
        "Private extraction isolation",
      ),
    ).toEqual([]);
    const projectEvidence = checked(
      await professional.db.rpc("search_agent_evidence", {
        e,
        v: "shared",
        q: "PRIVATE FIXTURE internal planning",
      }),
      "Project retrieval privacy",
    );
    expect(JSON.stringify(projectEvidence)).not.toContain("PRIVATE FIXTURE");
    expect(
      (
        await professional.db.rpc("search_agent_evidence", {
          e,
          v: "client",
          q: "planning",
        })
      ).error,
    ).not.toBeNull();
    expect(
      (
        await professional.db.storage
          .from("engagement-files")
          .download(privateFile.object_path)
      ).error,
    ).not.toBeNull();
    await expect(cp.locator("[data-live-state]")).toHaveAttribute(
      "data-live-state",
      "connected",
      { timeout: 20000 },
    );
    async function observe(db: SupabaseClient, side: string) {
      const rows: string[] = [];
      const channel = db
        .channel(`fixture:${run}:${side}`, {
          config: { postgres_changes_options: { wait: true } },
        })
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `engagement_id=eq.${e}`,
          },
          (p) => rows.push(p.new.id),
        );
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Authenticated subscription timed out")),
          25000,
        );
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            clearTimeout(timer);
            resolve();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            clearTimeout(timer);
            reject(new Error("Authenticated subscription unavailable"));
          }
        });
      });
      return rows;
    }
    const realtimeRows = await observe(client.db, "client");
    const professionalEvents = await observe(professional.db, "professional");
    const clientPrivateId = checked(
      await client.db.rpc("send_message", {
        e,
        v: "client",
        b: "PRIVATE REALTIME FIXTURE: client-only note.",
      }),
      "Client private realtime",
    );
    const proPrivateId = checked(
      await professional.db.rpc("send_message", {
        e,
        v: "professional",
        b: "PRIVATE REALTIME FIXTURE: professional-only note.",
      }),
      "Professional private realtime",
    );
    expect(
      (
        await professional.db.rpc("send_message", {
          e,
          v: "client",
          b: "Forbidden write",
        })
      ).error,
    ).not.toBeNull();
    // Remain on the page: only a Realtime insert notification can surface this message.
    const liveId = checked(
      await professional.db.rpc("send_message", {
        e,
        v: "shared",
        b: "LIVE FIXTURE: Please confirm the CSV timezone.",
      }),
      "Shared realtime message",
    );
    await expect
      .poll(
        () =>
          realtimeRows.includes(liveId) && professionalEvents.includes(liveId),
        { timeout: 25000 },
      )
      .toBe(true);
    expect(realtimeRows).toContain(clientPrivateId);
    expect(realtimeRows).not.toContain(proPrivateId);
    expect(professionalEvents).toContain(proPrivateId);
    expect(professionalEvents).not.toContain(clientPrivateId);
    expect(
      checked(
        await professional.db
          .from("notifications")
          .select("id")
          .eq("record_id", clientPrivateId),
        "Private notification isolation",
      ),
    ).toEqual([]);
    await expect(
      cp.getByText("LIVE FIXTURE: Please confirm the CSV timezone.", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 25000 });
    const thread = cp
      .locator("section")
      .filter({
        has: cp.getByText("LIVE FIXTURE: Please confirm the CSV timezone.", {
          exact: true,
        }),
      })
      .last();
    await thread.getByText("Reply in thread", { exact: true }).click();
    await thread
      .getByLabel("Reply to this message", { exact: true })
      .fill("THREAD FIXTURE: Please use UTC reporting dates.");
    await thread
      .getByRole("button", { name: "Send reply", exact: true })
      .click();
    await expect(
      pp.getByText("THREAD FIXTURE: Please use UTC reporting dates.", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 25000 });
    await expect(cp.getByRole("checkbox", { name: /Mention/ })).toHaveCount(0);
    await pp.goto(`/workspace/${e}?tab=files`);
    await send(cp, "UNREAD FIXTURE: Please review the CSV requirements.");
    const unreadMessage = checked(await client.db.from("messages").select("id").eq("engagement_id", e).eq("body", "UNREAD FIXTURE: Please review the CSV requirements.").single(), "Unread message");
    await expect
      .poll(
        async () =>
          checked(
            await professional.db
              .from("notifications")
              .select("id")
              .eq("engagement_id", e)
              .eq("record_id", unreadMessage.id)
              .eq("kind", "message")
              .is("seen_at", null),
            "Automatic unread notification",
          ).length,
      )
      .toBe(1);
    await pp.bringToFront();
    await pp.goto(`/workspace/${e}?tab=discussion`);
    await pp.getByTestId("discussion-read-marker").scrollIntoViewIfNeeded();
    await expect.poll(async () => checked(await professional.db.from("notifications").select("id").eq("record_id", unreadMessage.id).is("seen_at", null), "Read notification").length).toBe(0);
    await cp
      .getByRole("link", { name: "Your private assistant", exact: true })
      .click();
    await cp.getByRole("link",{name:"Shared workspace",exact:true}).click();
    await cp.getByLabel("Message",{exact:true}).fill("We will supply weekly UTF-8 CSV exports.");
    await cp.getByRole("button",{name:"Send message",exact:true}).click();
    await expect(
      pp.getByText("We will supply weekly UTF-8 CSV exports.", { exact: true }),
    ).toBeVisible({ timeout: 25000 });
    await expect(
      pp.getByText(
        "PRIVATE FIXTURE: internal budget ceiling must remain confidential.",
      ),
    ).toHaveCount(0);
    await cp.goto("/workspace/" + e);
    await cp.locator("#message-file").setInputFiles({
      name: "example-revenue.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("region,revenue\nSouth,1200\nNorth,800\n"),
    });
    await cp.getByLabel("Message", { exact: true })
      .fill("Here is the example revenue CSV for the dashboard.");
    await cp.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(
      cp.getByText("Here is the example revenue CSV for the dashboard.", { exact: true }),
    ).toBeVisible();
    await expect(cp.getByRole("link", { name: "Open attachment: example-revenue.csv" })).toBeVisible();
    checked(
      await client.db
        .from("attachments")
        .select("object_path")
        .eq("engagement_id", e)
        .eq("visibility", "shared"),
      "Shared files",
    );
    await pp.getByRole("link", { name: "files", exact: true }).click();
    await expect(
      pp.getByText("example-revenue.csv", { exact: true }),
    ).toBeVisible();
    await expect(pp.getByText("private-planning.txt")).toHaveCount(0);
    await pp
      .getByLabel("Search file names", { exact: true })
      .fill("missing-file");
    await expect(
      pp.getByText("No files match these filters.", { exact: true }),
    ).toBeVisible();
    await pp.getByLabel("Search file names", { exact: true }).fill("revenue");
    await pp.getByText("Extracted text preview", { exact: true }).click();
    await expect(
      pp.getByText("region,revenue", { exact: false }),
    ).toBeVisible();
    await expect(
      pp.getByRole("link", { name: "Source discussion message", exact: true }),
    ).toBeVisible();
    const downloading = pp.waitForEvent("download");
    await pp.getByRole("button", { name: "Download", exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("example-revenue.csv");
    expect(await download.failure()).toBeNull();
    const sharedText = checked(
      await professional.db.rpc("search_agent_evidence", {
        e,
        v: "shared",
        q: "region revenue",
      }),
      "Shared file retrieval",
    );
    expect(JSON.stringify(sharedText)).toContain("South,1200");
    expect(JSON.stringify(sharedText)).not.toContain("PRIVATE FIXTURE");
    await cp.getByRole("link", { name: "AI tokens", exact: true }).click();
    await expect(
      cp.getByRole("heading", { name: "AI usage tokens", exact: true }),
    ).toBeVisible();
    await expect(cp.getByText("50 tokens", { exact: true }).first()).toBeVisible();
    await cp
      .getByRole("link", { name: "Your private assistant", exact: true })
      .click();
    await expect(
      cp.getByText("Your private client tokens", { exact: true }),
    ).toBeVisible();
    await expect(
      cp.getByText("Tokens are low.", { exact: false }),
    ).toBeVisible();
    await cp.goto(`/workspace/${e}?tab=milestones`);
    await expect(cp.getByRole("link", { name: "agreement", exact: true })).toHaveCount(0);
    await fillScope(cp);
    await cp.locator("article[id^=milestone-] > details > summary").first().click();
    await expect(cp.getByText("Version 1 approvals: client", { exact: true })).toBeVisible();
    await pp.goto(`/workspace/${e}?tab=milestones`);
    await pp.locator("article[id^=milestone-] > details > summary").first().click();
    await pp.getByRole("button", { name: "Accept version 1", exact: true }).click();
    await expect(pp.locator("[data-active=true]").getByText("Active",{exact:true})).toBeVisible();
    const original = checked(
      await client.db
        .from("engagements")
        .select("accepted_version_id")
        .eq("id", e)
        .single(),
      "Accepted agreement",
    ).accepted_version_id;
    await fillScope(pp, true);
    await expect(pp.getByText("Pending amendment · version 2")).toBeVisible();
    expect(
      checked(
        await client.db
          .from("engagements")
          .select("accepted_version_id")
          .eq("id", e)
          .single(),
        "Historical agreement",
      ).accepted_version_id,
    ).toBe(original);
    expect(
      (await client.db.rpc("approve_scope", { s: original })).error,
    ).not.toBeNull();
    await cp.reload();
    await cp.getByRole("button", { name: "Accept version 2", exact: true }).click();
    await pp.goto(`/workspace/${e}?tab=milestones`);
    await pp.getByText("Delivery and progress", { exact: true }).click();
    await pp.getByLabel("Reported progress (%)", { exact: true }).fill("100");
    await pp
      .getByRole("button", { name: "Update progress", exact: true })
      .click();
    await pp.getByText("Submit formal delivery", { exact: true }).click();
    await pp
      .getByLabel("Delivery message", { exact: true })
      .fill("The dashboard and weekly report reconcile to the supplied CSV.");
    await pp
      .getByRole("checkbox", { name: "example-revenue.csv", exact: true })
      .check();
    await pp
      .getByRole("button", { name: "Submit delivery for review", exact: true })
      .click();
    await expect(
      pp.getByRole("heading", {
        name: "Delivery 1 · Awaiting client review",
        exact: true,
      }),
    ).toBeVisible();
    await cp.goto(`/workspace/${e}?tab=milestones`);
    await cp.getByText("Delivery and progress", { exact: true }).click();
    await cp
      .getByLabel("Review reason tied to the acceptance criteria", {
        exact: true,
      })
      .fill(
        "CSV totals and scheduled report match the agreed regional figures.",
      );
    await cp
      .getByRole("button", { name: "Accept delivery 1", exact: true })
      .click();
    await expect(
      cp.locator("article[id^=milestone-] > details > summary").getByText("Completed", { exact: true }),
    ).toBeVisible();
    await cp.screenshot({
      path: "test-results/integration-milestones.png",
      fullPage: true,
    });
    await cp.getByRole("link", { name: "calendar", exact: true }).click();
    await cp.getByText("Propose a review meeting", { exact: true }).click();
    await cp
      .getByLabel("Meeting title", { exact: true })
      .fill("Dashboard delivery review");
    const meetingDay = new Date(Date.now() + 3 * 86400000)
      .toISOString()
      .slice(0, 10);
    await cp
      .getByLabel("Local date and time", { exact: true })
      .fill(meetingDay + "T15:00");
    await cp
      .getByLabel("IANA timezone", { exact: true })
      .fill("Africa/Johannesburg");
    await cp
      .getByRole("textbox", { name: "Agenda", exact: true })
      .fill("Review accepted totals and plan the reporting handover.");
    await cp
      .getByLabel("Related accepted milestone (optional)", { exact: true })
      .selectOption({ label: "Dashboard and weekly reports" });
    await cp
      .getByRole("button", { name: "Propose meeting", exact: true })
      .click();
    await expect(
      cp.getByText("Version 1 · tentative", { exact: true }),
    ).toBeVisible();
    await pp.goto(`/workspace/${e}?tab=calendar`);
    await pp
      .getByRole("button", { name: "Accept meeting time", exact: true })
      .click();
    await expect(
      pp.getByText("Version 1 · confirmed", { exact: true }),
    ).toBeVisible();
    const meeting = checked(
      await client.db
        .from("meetings")
        .select("id,accepted_version_id")
        .eq("engagement_id", e)
        .single(),
      "Confirmed meeting",
    );
    expect(meeting.accepted_version_id).toBeTruthy();
    const ics = await pp.request.get(`/api/meetings/${meeting.id}/calendar`);
    expect(ics.status()).toBe(200);
    expect(ics.headers()["content-type"]).toContain("text/calendar");
    const icsText = await ics.text();
    expect(icsText).toContain("STATUS:CONFIRMED");
    expect(icsText).toContain("T130000Z");
    expect(icsText).not.toContain("PRIVATE FIXTURE");
    const anonymous = await browser.newContext();
    expect(
      (
        await anonymous.request.get(
          `http://127.0.0.1:3200/api/meetings/${meeting.id}/calendar`,
        )
      ).status(),
    ).toBe(401);
    await anonymous.close();
    await pp
      .getByText("Meeting notes and follow-up actions", { exact: true })
      .click();
    await pp
      .getByLabel("Shared meeting notes", { exact: true })
      .fill(
        "Handover includes the agreed CSV totals checklist. No new scope agreed.",
      );
    await pp.getByRole("button", { name: "Save notes", exact: true }).click();
    await expect(
      pp.getByText(
        "Handover includes the agreed CSV totals checklist. No new scope agreed.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      pp.locator('[data-bryntum-view="calendar"] .b-calendar'),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      pp
        .locator('[data-bryntum-view="calendar"]')
        .getByText("Dashboard delivery review", { exact: true })
        .first(),
    ).toBeVisible();
    await pp.screenshot({
      path: "test-results/integration-calendar-desktop.png",
      fullPage: true,
    });
    await pp.setViewportSize({ width: 390, height: 844 });
    await pp.screenshot({
      path: "test-results/integration-calendar-mobile.png",
      fullPage: true,
    });
    expect(
      await pp.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await pp.setViewportSize({ width: 1280, height: 900 });
    await pp.goto("/calendar");
    await expect(
      pp.getByRole("heading", {
        name: "Dashboard delivery review",
        exact: true,
      }),
    ).toBeVisible();
    await cp.goto("/profile");
    await cp
      .getByLabel("Display name", { exact: true })
      .fill("[E2E] Demonstration client");
    await cp
      .getByLabel("Public description", { exact: true })
      .fill(
        "Temporary labelled browser-test fixture; not a real reputation claim.",
      );
    await cp
      .getByRole("button", { name: "Save profile and visibility", exact: true })
      .click();
    await expect(cp.getByRole("status")).toHaveText("Saved.");
    await pp.goto("/profile");
    await pp
      .getByLabel("Display name", { exact: true })
      .fill("[E2E] Demonstration professional");
    await pp
      .getByLabel("Professional or company identity (optional)", {
        exact: true,
      })
      .fill("[E2E] Demo consultancy");
    await pp
      .getByLabel("Public description", { exact: true })
      .fill(
        "Temporary labelled browser-test fixture. Demo feedback is excluded.",
      );
    await pp
      .getByRole("checkbox", {
        name: "Make my profile, published feedback and eligible activity facts public",
        exact: true,
      })
      .check();
    await pp
      .getByRole("button", { name: "Save profile and visibility", exact: true })
      .click();
    await expect(pp.getByRole("status")).toHaveText("Saved.");
    await cp.goto(`/workspace/${e}?tab=discussion`);
    await cp.getByText("End engagement", { exact: true }).first().click();
    await cp
      .getByLabel("Outcome reason", { exact: true })
      .fill("Accepted delivery and handover are complete.");
    await cp
      .getByRole("button", {
        name: "Confirm completion as client",
        exact: true,
      })
      .click();
    await expect(
      cp.getByText("Completion confirmations: client", { exact: true }),
    ).toBeVisible();
    await pp.goto(`/workspace/${e}?tab=discussion`);
    await pp.locator("header > details > summary").click();
    await pp
      .getByLabel("Outcome reason", { exact: true })
      .fill("The agreed reporting work and handover are complete.");
    await pp
      .getByRole("button", {
        name: "Confirm completion as professional",
        exact: true,
      })
      .click();
    const professionalFeedback =
      "[E2E] The client provided clear sample data and reviewed the deliverable promptly.";
    await pp
      .getByLabel("Written feedback about the client", { exact: true })
      .fill(professionalFeedback);
    for (const label of [
      "Communication (1–5)",
      "Clarity (1–5)",
      "Collaboration (1–5)",
      "Honouring agreements (1–5)",
    ])
      await pp.getByLabel(label, { exact: true }).selectOption("5");
    await pp
      .getByRole("button", { name: "Submit private feedback", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          checked(
            await professional.db
              .from("reviews")
              .select("id")
              .eq("engagement_id", e),
            "Own submitted review",
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
      checked(
        await client.db.from("reviews").select("body").eq("engagement_id", e),
        "Double-blind hosted privacy",
      ),
    ).toEqual([]);
    await cp.reload();
    await expect(
      cp.getByText(professionalFeedback, { exact: true }),
    ).toHaveCount(0);
    await cp
      .getByLabel("Written feedback about the professional", { exact: true })
      .fill(
        "[E2E] The professional explained tradeoffs and delivered the agreed reporting totals.",
      );
    for (const label of [
      "Communication (1–5)",
      "Delivery (1–5)",
      "Collaboration (1–5)",
      "Honouring agreements (1–5)",
    ])
      await cp.getByLabel(label, { exact: true }).selectOption("5");
    await cp
      .getByRole("button", { name: "Submit private feedback", exact: true })
      .click();
    await expect(
      cp.getByText(professionalFeedback, { exact: true }),
    ).toBeVisible();
    expect(
      checked(
        await client.db.from("reviews").select("id").eq("engagement_id", e),
        "Mutual publication",
      ),
    ).toHaveLength(2);
    await cp
      .getByLabel("Your public reply", { exact: true })
      .fill("[E2E] Thank you for explaining the reporting assumptions.");
    await cp
      .getByRole("button", { name: "Submit frozen reply", exact: true })
      .click();
    await expect(
      cp.locator("p.notice").filter({
        hasText: "[E2E] Thank you for explaining the reporting assumptions.",
      }),
    ).toBeVisible();
    await cp.screenshot({
      path: "test-results/integration-reputation.png",
      fullPage: true,
    });
    const publicFixture = checked(
      await client.db.rpc("public_profile", { p: professional.id }),
      "Public demo exclusion",
    );
    expect(publicFixture.reviews).toEqual([]);
    expect(publicFixture.completionCount).toBe(0);
    await pp.goto(`/people/${professional.id}`);
    await expect(
      pp.getByRole("heading", {
        name: "[E2E] Demonstration professional",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      pp.getByRole("heading", {
        name: "Feedback as a professional · 0",
        exact: true,
      }),
    ).toBeVisible();
    await pp.screenshot({
      path: "test-results/integration-public-profile.png",
      fullPage: true,
    });
    // Joining did not consume the professional's own first-creation grant.
    checked(
      await professional.db.rpc("create_engagement", {
        p_title: "[E2E] Professional first creation " + run,
        p_role: "professional",
      }),
      "Invitee first creation",
    );
    expect(
      checked(
        await professional.db.from("starter_grants").select("engagement_id"),
        "Invitee starter grant",
      ),
    ).toHaveLength(1);
    const roleSwitch = await client.db.rpc("set_active_role", {
      next_role: "professional",
    });
    expect(roleSwitch.error).toBeNull();
    const pending = checked(
      await client.db.rpc("create_engagement", {
        p_title: "[E2E] Pending creation " + run,
        p_role: "professional",
      }),
      "Pending second creation",
    );
    expect(
      checked(
        await client.db
          .from("engagements")
          .select("funding")
          .eq("id", pending)
          .single(),
        "Pending funding",
      ).funding,
    ).toBe("pending");
    expect(
      (
        await client.db.rpc("create_invitation", {
          e: pending,
          target_email: professional.email,
        })
      ).error,
    ).not.toBeNull();
    await cp.goto("/workspace/" + e);
    await expect(cp.locator("[data-live-state]")).toHaveAttribute(
      "data-live-state",
      "connected",
      { timeout: 25000 },
    );
    await cp.screenshot({
      path: "test-results/integration-desktop.png",
      fullPage: true,
      caret: "initial",
    });
    await cp.setViewportSize({ width: 390, height: 844 });
    await cp.reload();
    await expect(cp.getByRole("heading", { name: title })).toBeVisible();
    expect(
      await cp.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(cp.locator("[data-live-state]")).toHaveAttribute(
      "data-live-state",
      "connected",
      { timeout: 25000 },
    );
    await cp.screenshot({
      path: "test-results/integration-mobile.png",
      fullPage: true,
      caret: "initial",
    });
  } finally {
    await Promise.allSettled(contexts.map((c) => c.close()));
    await Promise.all(actors.map((a) => a.db.removeAllChannels()));
  }
});

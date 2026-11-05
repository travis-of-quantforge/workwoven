import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import fs from "node:fs";
import { cleanupIntegrationRun } from "../../scripts/integration-fixtures.mjs";
function checked<
  T extends { data: unknown; error: { message: string } | null },
>(r: T): NonNullable<T["data"]> {
  if (r.error || r.data === null) throw new Error("Fixture operation failed");
  return r.data as NonNullable<T["data"]>;
}
test("licensed Bryntum views preserve accepted schedules, show proposals and safely render meeting titles", async ({
  browser,
}) => {
  test.setTimeout(240000);
  test.skip(
    !process.env.NEXT_PUBLIC_BRYNTUM_LICENSE_KEY ||
      !process.env.SUPABASE_SECRET_KEY,
    "Requires configured trial licence and development Supabase",
  );
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
  const run = randomUUID(),
    password = randomBytes(24).toString("base64url") + "aA1!";
  fs.mkdirSync(".integration-runs", { recursive: true });
  fs.writeFileSync(`.integration-runs/${run}.json`, JSON.stringify({ run }));
  const context = await browser.newContext(),
    page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => {
    errors.push(e.name);
    console.log(
      "BROWSER ERROR",
      e.message
        .replaceAll(process.env.NEXT_PUBLIC_BRYNTUM_LICENSE_KEY!, "[redacted]")
        .slice(0, 1600),
    );
  });
  page.on("console", (m) => {
    if (m.type() === "error")
      console.log(
        "BROWSER CONSOLE",
        m
          .text()
          .replaceAll(
            process.env.NEXT_PUBLIC_BRYNTUM_LICENSE_KEY!,
            "[redacted]",
          )
          .slice(0, 1600),
      );
  });
  try {
    async function actor(side: string) {
      const email = `workspace-e2e-${run}-${side}@example.test`;
      const link = checked(
        await admin.auth.admin.generateLink({
          type: "signup",
          email,
          password,
          options: { data: { workspace_test_run: run } },
        }),
      );
      if (!link.properties || !link.user)
        throw new Error("Fixture unavailable");
      const db = createClient(url, key, { auth: { persistSession: false } });
      checked(
        await db.auth.verifyOtp({
          type: "signup",
          token_hash: link.properties.hashed_token,
        }),
      );
      return { db, email };
    }
    const client = await actor("client"),
      pro = await actor("professional");
    const e = checked(
      await client.db.rpc("create_engagement", {
        p_title: "[E2E] Bryntum " + run,
        p_role: "client",
      }),
    );
    checked(
      await admin
        .from("engagements")
        .update({ is_demo: true })
        .eq("id", e)
        .select("id"),
    );
    const token = checked(
      await client.db.rpc("create_invitation", { e, target_email: pro.email }),
    );
    checked(await pro.db.rpc("accept_invitation", { t: token }));
    const day = (n: number) =>
        new Date(Date.now() + n * 86400000).toISOString().slice(0, 10),
      first = randomUUID(),
      second = randomUUID();
    const malicious = 'Dashboard <img src=x onerror="window.fixtureXss=1">';
    const tasks = [
      {
        key: first,
        title: malicious,
        owner: "professional",
        startDate: day(1),
        endDate: day(4),
        acceptanceCriteria: "Totals match",
        paymentTerms: "On acceptance",
        amountCents: 10000,
        dependencies: [],
      },
      {
        key: second,
        title: "Client review",
        owner: "client",
        startDate: day(4),
        endDate: day(6),
        acceptanceCriteria: "Review supplied checklist",
        paymentTerms: "Included",
        amountCents: 0,
        dependencies: [first],
      },
    ];
    const s = checked(
      await pro.db.rpc("submit_scope", {
        e,
        expected: null,
        c: {
          deliverables: "Reporting dashboard",
          exclusions: "Email",
          assumptions: "CSV",
          responsibilities: "Data",
          acceptanceCriteria: "Totals match",
          priceCents: 10000,
          currency: "USD",
          paymentTerms: "On acceptance",
          schedule: "One week",
          milestones: tasks,
        },
      }),
    );
    for (const a of [client, pro]) {
      const r = await a.db.rpc("approve_scope", { s });
      if (r.error) throw new Error("Approval failed");
    }
    const proposed = checked(
      await pro.db.rpc("propose_milestones", {
        e,
        tasks: [{ ...tasks[0], endDate: day(3) }, tasks[1]],
        expected: s,
        base: s,
        reason: "Propose earlier handover; accepted dates remain unchanged.",
      }),
    );
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(client.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("http://127.0.0.1:3200/");
    await page.goto(`/workspace/${e}?tab=milestones`);
    await expect(
      page.locator('[data-bryntum-view="gantt"] .b-gantt'),
    ).toHaveCount(2, { timeout: 60000 });
    await expect(
      page.locator('[data-bryntum-view="gantt"] .b-gantt-task-wrap'),
    ).toHaveCount(4, { timeout: 30000 });
    expect(await page.evaluate(() => "fixtureXss" in window)).toBe(false);
    await expect(
      page.locator('[data-bryntum-view="gantt"] img[src=x]'),
    ).toHaveCount(0);
    await expect(page.locator(".b-license-mask")).toHaveCount(0);
    const chartState = await page.evaluate(() => {
      const runtime = globalThis as unknown as {
        bryntum: {
          queryAll: (type: string) => {
            readOnly: boolean;
            taskStore: {
              records: { id: string; startDate: Date; endDate: Date }[];
            };
          }[];
        };
      };
      const date = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return runtime.bryntum.queryAll("gantt").map((g) => ({
        readOnly: g.readOnly,
        dates: g.taskStore.records.map((t) => ({
          start: date(t.startDate),
          end: date(t.endDate),
        })),
      }));
    });
    expect(chartState).toHaveLength(2);
    expect(chartState.every((g) => g.readOnly)).toBe(true);
    expect(chartState[0].dates[0]).toEqual({
      start: tasks[0].startDate,
      end: tasks[0].endDate,
    });
    const before = checked(
      await client.db
        .from("scope_versions")
        .select("content")
        .eq("id", s)
        .single(),
    );
    const bar = page
      .locator('[data-bryntum-view="gantt"] .b-gantt-task-wrap')
      .first();
    const box = await bar.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 5, box.y + 8);
      await page.mouse.down();
      await page.mouse.move(box.x + 70, box.y + 8, { steps: 5 });
      await page.mouse.up();
    }
    expect(
      checked(
        await client.db
          .from("scope_versions")
          .select("content")
          .eq("id", s)
          .single(),
      ),
    ).toEqual(before);
    await page.screenshot({
      path: "test-results/bryntum-gantt-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/bryntum-gantt-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    const m = checked(
      await client.db.rpc("propose_meeting", {
        e,
        m: null,
        expected: null,
        title: malicious,
        agenda: "Review agreed reporting totals",
        starts: day(3) + "T13:00:00Z",
        ends: day(3) + "T13:30:00Z",
        zone: "Africa/Johannesburg",
        url: null,
        milestone: null,
        k: randomUUID(),
      }),
    );
    const version = checked(
      await pro.db
        .from("meeting_versions")
        .select("id")
        .eq("meeting_id", m)
        .single(),
    );
    const r = await pro.db.rpc("respond_meeting", {
      v: version.id,
      answer: "accepted",
      reason: "Confirmed",
    });
    if (r.error) throw new Error("Meeting response failed");
    checked(
      await client.db.rpc("propose_meeting", {
        e,
        m,
        expected: version.id,
        title: "Revised review time",
        agenda: "Proposed new date",
        starts: day(4) + "T13:00:00Z",
        ends: day(4) + "T13:30:00Z",
        zone: "UTC",
        url: null,
        milestone: null,
        k: randomUUID(),
      }),
    );
    await page.goto(`/workspace/${e}?tab=calendar`);
    await expect(
      page.locator('[data-bryntum-view="calendar"] .b-calendar'),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      page
        .locator('[data-bryntum-view="calendar"]')
        .getByText("Tentative: Revised review time", { exact: true })
        .first(),
    ).toBeVisible();
    await expect(
      page.locator('[data-bryntum-view="calendar"] img[src=x]'),
    ).toHaveCount(0);
    expect(await page.evaluate(() => "fixtureXss" in window)).toBe(false);
    await expect(page.locator(".b-license-mask")).toHaveCount(0);
    await page.screenshot({
      path: "test-results/bryntum-calendar-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/bryntum-calendar-mobile.png",
      fullPage: true,
    });
    expect(
      checked(
        await client.db
          .from("engagements")
          .select("accepted_version_id")
          .eq("id", e)
          .single(),
      ).accepted_version_id,
    ).toBe(s);
    expect(proposed).not.toBe(s);
    expect(errors).toEqual([]);
  } catch (error) {
    await page
      .screenshot({ path: "test-results/bryntum-failure.png", fullPage: true })
      .catch(() => {});
    throw error;
  } finally {
    await context.close();
    await cleanupIntegrationRun(run, admin);
  }
});

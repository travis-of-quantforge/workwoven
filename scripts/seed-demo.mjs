import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Demo seed only runs against local Supabase.");
if (!process.env.SEED_PASSWORD || process.env.SEED_PASSWORD.length < 12)
  throw new Error(
    "Set SEED_PASSWORD to a local-only password of at least 12 characters.",
  );
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});
async function checked(result) {
  if (result.error) throw result.error;
  return result.data;
}
async function actor(email) {
  const listed = await checked(await admin.auth.admin.listUsers());
  if (!listed.users.some((u) => u.email === email))
    await checked(
      await admin.auth.admin.createUser({
        email,
        password: process.env.SEED_PASSWORD,
        email_confirm: true,
        user_metadata: { profile_type: email.startsWith("professional") ? "professional" : "client" },
      }),
    );
  const db = createClient(
    url,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false } },
  );
  await checked(
    await db.auth.signInWithPassword({
      email,
      password: process.env.SEED_PASSWORD,
    }),
  );
  return db;
}
const client = await actor("client@example.test");
const professional = await actor("professional@example.test");
const existing = await checked(
  await client
    .from("engagements")
    .select("id")
    .eq("title", "[Demo] Reporting dashboard"),
);
if (existing.length) {
  console.log("Demo engagement already exists; leaving it unchanged.");
  process.exit(0);
}
const e = await checked(
  await client.rpc("create_engagement", {
    p_title: "[Demo] Reporting dashboard",
    p_role: "client",
  }),
);
await checked(
  await admin.from("engagements").update({ is_demo: true }).eq("id", e),
);
const token = await checked(
  await client.rpc("create_invitation", {
    e,
    target_email: "professional@example.test",
  }),
);
await checked(await professional.rpc("accept_invitation", { t: token }));
await checked(
  await client.rpc("send_message", {
    e,
    v: "shared",
    b: "We need a weekly reporting dashboard showing revenue, refunds and regional totals from our CSV export. Scheduled emails are outside the initial brief.",
  }),
);
await checked(
  await professional.rpc("send_message", {
    e,
    v: "shared",
    b: "I can deliver an accessible dashboard with CSV import, date filters and a reconciled totals view. Please supply a representative export and confirm the reporting timezone.",
  }),
);
await checked(
  await client.rpc("send_message", {
    e,
    v: "client",
    b: "PRIVATE DEMO: Our internal budget ceiling is confidential. This note must never appear in the project agent context.",
  }),
);
const sample = Buffer.from(
  "region,revenue,refunds\nSouth,1200,50\nNorth,800,20\n",
);
const path = await checked(
  await client.rpc("register_attachment", {
    e,
    v: "shared",
    n: "example-revenue.csv",
    mime: "text/csv",
    bytes: sample.length,
  }),
);
await checked(
  await client.storage
    .from("engagement-files")
    .upload(path, sample, { contentType: "text/csv", upsert: false }),
);
await checked(await client.rpc("confirm_attachment_with_message", {
  p: path,
  b: "Here is the example revenue CSV for the dashboard discussion.",
}));
const clientUser = await checked(await client.auth.getUser());
await checked(
  await admin.rpc("store_attachment_text", {
    p: path,
    actor: clientUser.user.id,
    body: sample.toString("utf8"),
    hash: createHash("sha256").update(sample).digest("hex"),
    is_complete: true,
  }),
);
const day = (offset) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const taskKey = randomUUID();
const s = await checked(
  await professional.rpc("submit_scope", {
    e,
    expected: null,
    c: {
      milestones: [
        {
          key: taskKey,
          title: "Dashboard with reconciled CSV totals",
          owner: "professional",
          startDate: day(1),
          endDate: day(11),
          acceptanceCriteria:
            "Regional totals and filters match the supplied example CSV.",
          paymentTerms:
            "After client acceptance; no payment is created by this seed.",
          amountCents: 100000,
          dependencies: [],
        },
      ],
      deliverables:
        "CSV import and responsive reporting dashboard with revenue, refunds and regional totals.",
      exclusions:
        "Scheduled email reports, hosting and external data connectors.",
      assumptions: "Client supplies a documented CSV export.",
      responsibilities:
        "Provide representative data and review within two working days.",
      acceptanceCriteria:
        "Imported totals match the supplied CSV; date and region filters update all figures.",
      priceCents: 100000,
      currency: "USD",
      paymentTerms:
        "Payment after delivery acceptance; no payment is created by this demo seed.",
      schedule:
        "Dashboard delivered within ten working days of receiving the representative export.",
    },
  }),
);
await checked(await client.rpc("approve_scope", { s }));
await checked(await professional.rpc("approve_scope", { s }));
const taskRows = await checked(
  await professional
    .from("milestone_tasks")
    .select("id")
    .eq("version_id", s)
    .single(),
);
const attachment = await checked(
  await professional
    .from("attachments")
    .select("id")
    .eq("object_path", path)
    .single(),
);
await checked(
  await professional.rpc("submit_delivery", {
    t: taskRows.id,
    b: "Prepared demo delivery: review the totals checklist and representative CSV. This fixture does not claim to contain a tested dashboard application.",
    links: [],
    files: [attachment.id],
    k: randomUUID(),
  }),
);
const meeting = await checked(
  await client.rpc("propose_meeting", {
    e,
    m: null,
    expected: null,
    title: "Reporting dashboard review",
    agenda: "Review the CSV reconciliation checklist and handover questions.",
    starts: day(12) + "T13:00:00Z",
    ends: day(12) + "T13:30:00Z",
    zone: "Africa/Johannesburg",
    url: null,
    milestone: taskRows.id,
    k: randomUUID(),
  }),
);
const meetingVersion = await checked(
  await professional
    .from("meeting_versions")
    .select("id")
    .eq("meeting_id", meeting)
    .single(),
);
await checked(
  await professional.rpc("respond_meeting", {
    v: meetingVersion.id,
    answer: "accepted",
    reason: "This demo review time works.",
  }),
);
console.log(
  "Local demo seeded. Accounts: client@example.test and professional@example.test. Prepared schedule, example file, delivery and meeting records are demo-labelled. No payment, model call, public review or outreach was created.",
);

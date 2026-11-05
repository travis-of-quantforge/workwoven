import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { cleanupIntegrationRun } from "./integration-fixtures.mjs";
const folder = ".integration-runs";
const runs = fs.existsSync(folder)
  ? fs
      .readdirSync(folder)
      .filter((name) => /^[0-9a-f-]{36}\.json$/.test(name))
      .map((name) => name.slice(0, -5))
  : [];
if (!runs.length) {
  console.log("No interrupted integration runs recorded.");
  process.exit(0);
}
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
for (const run of runs) await cleanupIntegrationRun(run, admin);
console.log("Removed " + runs.length + " recorded test fixture run(s).");

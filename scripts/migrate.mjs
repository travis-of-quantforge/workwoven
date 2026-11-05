import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const mode = process.argv[2] || "--check";
if (!["--check", "--apply"].includes(mode))
  throw new Error("Use --check or --apply.");
if (!process.env.SUPABASE_DB_URL) {
  console.error("Set SUPABASE_DB_URL in .env.local. No database was changed.");
  process.exit(1);
}
let target;
try {
  target = new URL(process.env.SUPABASE_DB_URL);
} catch {
  console.error("SUPABASE_DB_URL must be a Postgres connection URI.");
  process.exit(1);
}
if (!["postgres:", "postgresql:"].includes(target.protocol))
  throw new Error("A Postgres connection URI is required.");
const local = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
if (
  !local &&
  !target.hostname.endsWith(".supabase.co") &&
  !target.hostname.endsWith(".supabase.com")
)
  throw new Error("Expected a Supabase database or local test target.");
const sslmode =
  target.searchParams.get("sslmode") || (local ? "disable" : "verify-full");
if (!local && !["require", "verify-ca", "verify-full"].includes(sslmode))
  throw new Error("Remote database connections must use TLS.");
const env = {
  ...process.env,
  PGHOST: target.hostname,
  PGPORT: target.port || "5432",
  PGDATABASE: decodeURIComponent(target.pathname.slice(1) || "postgres"),
  PGUSER: decodeURIComponent(target.username),
  PGPASSWORD: decodeURIComponent(target.password),
  PGSSLMODE: sslmode,
  PGCONNECT_TIMEOUT: "12",
};
// Credentials are passed only through child environment, never process arguments or output.
function query(sql) {
  const r = spawnSync("psql", ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
    env,
    maxBuffer: 1024 * 1024,
  });
  if (r.status !== 0) {
    const code = r.stderr?.match(/ERROR:\s*([^\n]+)/)?.[1];
    console.error(
      code
        ? "Database operation failed: " + code
        : "Database connection failed. Check the connection URI, network and TLS certificate settings.",
    );
    process.exit(1);
  }
  return r.stdout.trim();
}
const ledger =
  query("select to_regclass('workspace_internal.migrations') is not null;") ===
  "t";
const files = fs
  .readdirSync("supabase/migrations")
  .filter((n) => /^\d+_[a-z0-9_]+\.sql$/.test(n))
  .sort()
  .map((name) => ({
    name,
    sql: fs.readFileSync(path.join("supabase/migrations", name), "utf8"),
  }));
for (const f of files)
  f.checksum = createHash("sha256").update(f.sql).digest("hex");
const applied = ledger
  ? new Map(
      query(
        "select name,checksum from workspace_internal.migrations order by name;",
      )
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("|")),
    )
  : new Map();
for (const f of files)
  if (applied.has(f.name) && applied.get(f.name) !== f.checksum)
    throw new Error("An applied migration has changed: " + f.name);
for (const name of applied.keys())
  if (!files.some((f) => f.name === name))
    throw new Error("An applied migration is missing locally: " + name);
const pending = files.filter((f) => !applied.has(f.name));
console.log(
  "Database connection verified. " + pending.length + " pending migration(s).",
);
if (mode === "--check") {
  for (const f of pending) console.log("Pending: " + f.name);
  process.exit(0);
}
if (!pending.length) {
  console.log("Schema already up to date.");
  process.exit(0);
}
const history = applied.size
  ? ""
  : `do $$ begin if exists(select 1 from pg_catalog.pg_tables t where t.schemaname='public' and not exists(select 1 from pg_catalog.pg_depend d where d.objid=(quote_ident(t.schemaname)||'.'||quote_ident(t.tablename))::regclass and d.deptype='e')) then raise exception 'Public schema contains existing tables without Workspace migration history; inspect before applying'; end if; end $$;`;
const sql = `begin;\nselect pg_advisory_xact_lock(876541238);\n${history}\ncreate schema if not exists workspace_internal;\nrevoke all on schema workspace_internal from public,anon,authenticated;\ncreate table if not exists workspace_internal.migrations(name text primary key,checksum text not null,applied_at timestamptz not null default now());\n${pending.map((f) => f.sql + "\ninsert into workspace_internal.migrations(name,checksum) values ('" + f.name + "','" + f.checksum + "');").join("\n")}\ncommit;`;
query(sql);
console.log("Applied " + pending.length + " migration(s) atomically.");

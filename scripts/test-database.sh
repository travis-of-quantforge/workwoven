#!/usr/bin/env bash
set -euo pipefail
# Requires Postgres 18 tools; creates and removes an isolated test cluster.
pg_bin="${PG_BIN:-/usr/lib/postgresql/18/bin}"
task_dir="$(mktemp -d /tmp/workspace-test.XXXXXX)"
cleanup(){ "$pg_bin/pg_ctl" -D "$task_dir/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$task_dir"; }
trap cleanup EXIT
"$pg_bin/initdb" -D "$task_dir/data" -A trust --no-locale --encoding=UTF8 >/dev/null
"$pg_bin/pg_ctl" -D "$task_dir/data" -l "$task_dir/server.log" -o "-k $task_dir -p 55440 -h 127.0.0.1 -c wal_level=logical" start >/dev/null
export PGHOST="$task_dir" PGPORT=55440 PGDATABASE=postgres
psql -v ON_ERROR_STOP=1 -f tests/database-bootstrap.sql >/dev/null
export SUPABASE_DB_URL="postgresql://$(id -un)@127.0.0.1:55440/postgres?sslmode=disable"
node scripts/migrate.mjs --apply
node scripts/migrate.mjs --apply
node scripts/migrate.mjs --check
psql -v ON_ERROR_STOP=1 -f tests/database.sql >/dev/null
psql -v ON_ERROR_STOP=1 -f tests/account-context.sql >/dev/null
psql -v ON_ERROR_STOP=1 -f tests/credits.sql >/dev/null
psql -v ON_ERROR_STOP=1 -f tests/discussion.sql >/dev/null
psql -v ON_ERROR_STOP=1 -f tests/uploads.sql >/dev/null
psql -v ON_ERROR_STOP=1 -f tests/credit-accounting.sql >/dev/null
psql -v ON_ERROR_STOP=1 -f tests/agents.sql >/dev/null
psql -v ON_ERROR_STOP=1 -f tests/credit-source-concurrency.sql >/dev/null
psql -v ON_ERROR_STOP=1 -f tests/milestones.sql >/dev/null
psql -v ON_ERROR_STOP=1 -f tests/calendar.sql >/dev/null
psql -v ON_ERROR_STOP=1 -f tests/reputation.sql >/dev/null
psql -v ON_ERROR_STOP=1 -f tests/admin-credits.sql >/dev/null
psql -v ON_ERROR_STOP=1 -f tests/concerns-invitations.sql >/dev/null
psql -v ON_ERROR_STOP=1 -f tests/payment-requests.sql >/dev/null
psql -v ON_ERROR_STOP=1 -f tests/individual-milestones.sql >/dev/null
psql -v ON_ERROR_STOP=1 -f tests/payment-ledger.sql >/dev/null
psql -v ON_ERROR_STOP=1 -f tests/payment-cancellation.sql >/dev/null
psql -v ON_ERROR_STOP=1 -f tests/contracts-monitor.sql >/dev/null
psql -v ON_ERROR_STOP=1 -f tests/milestone-file-context.sql >/dev/null
psql -v ON_ERROR_STOP=1 -f tests/conversation-reviews.sql >/dev/null
psql -v ON_ERROR_STOP=1 -f tests/delivery-upload.sql >/dev/null
python3 tests/concurrency.py
# Apply the new migration over real multi-task legacy records in a separate
# disposable database, not just an empty schema.
createdb milestone_import
PGDATABASE=milestone_import psql -v ON_ERROR_STOP=1 < <(sed '/^create role /d' tests/database-bootstrap.sql) >/dev/null
for migration in supabase/migrations/*.sql; do
  if [[ "$migration" < "supabase/migrations/202611100029_" ]]; then
    PGDATABASE=milestone_import psql -1 -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
  fi
done
PGDATABASE=milestone_import psql -v ON_ERROR_STOP=1 -f tests/milestone-import-before.sql >/dev/null
PGDATABASE=milestone_import psql -1 -v ON_ERROR_STOP=1 -f supabase/migrations/202611100029_individual_milestones.sql >/dev/null
PGDATABASE=milestone_import psql -1 -v ON_ERROR_STOP=1 -f supabase/migrations/202611100030_milestone_payment_guards.sql >/dev/null
PGDATABASE=milestone_import psql -1 -v ON_ERROR_STOP=1 -f supabase/migrations/202611100031_milestone_approvals.sql >/dev/null
PGDATABASE=milestone_import psql -v ON_ERROR_STOP=1 -f tests/milestone-import-after.sql >/dev/null
printf 'Database permissions, approval, credit and concurrency assertions passed.\n'

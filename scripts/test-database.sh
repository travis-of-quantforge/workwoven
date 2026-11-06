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
python3 tests/concurrency.py
printf 'Database permissions, approval, credit and concurrency assertions passed.\n'

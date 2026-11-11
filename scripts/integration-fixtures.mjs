import { spawnSync } from "node:child_process";
import fs from "node:fs";
export async function cleanupIntegrationRun(run, admin) {
  if (!/^[0-9a-f-]{36}$/.test(run)) throw new Error("Invalid fixture run");
  const u = new URL(process.env.SUPABASE_DB_URL);
  const env = {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1) || "postgres"),
    PGSSLMODE: "verify-full",
    PGCONNECT_TIMEOUT: "12",
  };
  function query(sql) {
    const r = spawnSync("psql", ["-X", "-At", "-v", "ON_ERROR_STOP=1"], {
      env,
      input: sql,
      encoding: "utf8",
      timeout: 45000,
    });
    if (r.status !== 0)
      throw new Error(
        "Fixture database cleanup failed; labelled records retained for retry.",
      );
    return r.stdout.trim();
  }
  const discovered = JSON.parse(
    query(
      `with fixture_users as(select id from auth.users where raw_user_meta_data->>'workspace_test_run'='${run}'), fixture_engagements as(select id from public.engagements where creator_id in(select id from fixture_users) and title like '[E2E]%') select json_build_object('users',coalesce((select json_agg(id) from fixture_users),'[]'),'paths',coalesce((select json_agg(object_path) from public.attachments where engagement_id in(select id from fixture_engagements)),'[]'));`,
    ),
  );
  if (discovered.paths.length) {
    const { error } = await admin.storage
      .from("engagement-files")
      .remove(discovered.paths);
    if (error) throw new Error("Fixture storage cleanup failed.");
  }
  query(`begin;
 create temporary table fixture_users as select id from auth.users where raw_user_meta_data->>'workspace_test_run'='${run}';
 create temporary table fixture_engagements as select id from public.engagements where creator_id in(select id from fixture_users) and title like '[E2E]%';
 delete from public.admin_activity where actor_id in(select id from fixture_users) or subject_id in(select id from fixture_users) or engagement_id in(select id from fixture_engagements);
 delete from public.notifications where engagement_id in(select id from fixture_engagements);
 delete from public.discussion_reads where engagement_id in(select id from fixture_engagements);
 delete from public.message_mentions where message_id in(select id from public.messages where engagement_id in(select id from fixture_engagements));
 delete from public.agent_runs where engagement_id in(select id from fixture_engagements);
 delete from public.message_assessments where engagement_id in(select id from fixture_engagements);
 delete from public.scope_monitor_settings where engagement_id in(select id from fixture_engagements);
 update public.engagement_contracts set latest_version_id=null,accepted_version_id=null where engagement_id in(select id from fixture_engagements);
 delete from public.contract_approvals where version_id in(select id from public.contract_versions where engagement_id in(select id from fixture_engagements));
 delete from public.contract_versions where engagement_id in(select id from fixture_engagements);
 delete from public.engagement_contracts where engagement_id in(select id from fixture_engagements);
 delete from public.share_events where engagement_id in(select id from fixture_engagements);
 delete from public.audit_events where engagement_id in(select id from fixture_engagements);
 delete from public.review_reports where review_id in(select id from public.reviews where engagement_id in(select id from fixture_engagements));
 delete from public.review_replies where review_id in(select id from public.reviews where engagement_id in(select id from fixture_engagements));
 delete from public.review_moderations where review_id in(select id from public.reviews where engagement_id in(select id from fixture_engagements));
 delete from public.reviews where engagement_id in(select id from fixture_engagements);
 delete from public.review_windows where engagement_id in(select id from fixture_engagements);
 delete from public.completion_approvals where engagement_id in(select id from fixture_engagements);
 delete from public.portfolio_items where engagement_id in(select id from fixture_engagements);
 delete from public.concern_acknowledgements where case_id in(select id from public.concern_cases where engagement_id in(select id from fixture_engagements));
 delete from public.concern_updates where case_id in(select id from public.concern_cases where engagement_id in(select id from fixture_engagements));
 delete from public.concern_cases where engagement_id in(select id from fixture_engagements);
 delete from public.payment_ledger where engagement_id in(select id from fixture_engagements);
 delete from public.payment_refunds where engagement_id in(select id from fixture_engagements);
 delete from public.payment_transactions where engagement_id in(select id from fixture_engagements);
 delete from public.paypal_sellers where user_id in(select id from fixture_users);
 delete from public.payment_requests where engagement_id in(select id from fixture_engagements);
 delete from public.badge_awards where engagement_id in(select id from fixture_engagements);
 delete from public.meeting_notes where version_id in(select v.id from public.meeting_versions v join public.meetings m on m.id=v.meeting_id where m.engagement_id in(select id from fixture_engagements));
 delete from public.meeting_responses where version_id in(select v.id from public.meeting_versions v join public.meetings m on m.id=v.meeting_id where m.engagement_id in(select id from fixture_engagements));
 update public.meetings set accepted_version_id=null where engagement_id in(select id from fixture_engagements);
 delete from public.meeting_versions where meeting_id in(select id from public.meetings where engagement_id in(select id from fixture_engagements));
 delete from public.meetings where engagement_id in(select id from fixture_engagements);
 delete from public.delivery_files where submission_id in(select s.id from public.delivery_submissions s join public.milestone_tasks t on t.id=s.task_id where t.engagement_id in(select id from fixture_engagements));
 delete from public.delivery_reviews where submission_id in(select s.id from public.delivery_submissions s join public.milestone_tasks t on t.id=s.task_id where t.engagement_id in(select id from fixture_engagements));
 delete from public.delivery_submissions where task_id in(select id from public.milestone_tasks where engagement_id in(select id from fixture_engagements));
 delete from public.task_progress where task_id in(select id from public.milestone_tasks where engagement_id in(select id from fixture_engagements));
 delete from public.task_dependencies where version_id in(select id from public.scope_versions where engagement_id in(select id from fixture_engagements));
 delete from public.milestone_events where milestone_id in(select id from public.milestones where engagement_id in(select id from fixture_engagements));
 delete from public.milestone_operations where engagement_id in(select id from fixture_engagements);
 update public.milestones set latest_version_id=null,accepted_version_id=null where engagement_id in(select id from fixture_engagements);
 delete from public.milestone_approvals where version_id in(select v.id from public.milestone_versions v join public.milestones m on m.id=v.milestone_id where m.engagement_id in(select id from fixture_engagements));
 delete from public.milestone_versions where milestone_id in(select id from public.milestones where engagement_id in(select id from fixture_engagements));
 delete from public.milestones where engagement_id in(select id from fixture_engagements);
 delete from public.milestone_tasks where engagement_id in(select id from fixture_engagements);
 delete from public.approvals where version_id in(select id from public.scope_versions where engagement_id in(select id from fixture_engagements));
 update public.engagements set accepted_version_id=null where id in(select id from fixture_engagements);
 delete from public.scope_versions where engagement_id in(select id from fixture_engagements);
 delete from public.attachment_texts where attachment_id in(select id from public.attachments where engagement_id in(select id from fixture_engagements));
 delete from public.attachments where engagement_id in(select id from fixture_engagements);
 delete from public.messages where engagement_id in(select id from fixture_engagements);
 delete from public.invitations where engagement_id in(select id from fixture_engagements);
 delete from public.starter_grants where user_id in(select id from fixture_users);
 delete from public.admin_credit_adjustments where account_id in(select id from public.agent_accounts where engagement_id in(select id from fixture_engagements));
 delete from public.credit_ledger where account_id in(select id from public.agent_accounts where engagement_id in(select id from fixture_engagements));
 delete from public.usage_corrections where operation_id in(select id from public.usage_operations where account_id in(select id from public.agent_accounts where engagement_id in(select id from fixture_engagements)));
 delete from public.usage_metering where operation_id in(select id from public.usage_operations where account_id in(select id from public.agent_accounts where engagement_id in(select id from fixture_engagements)));
 delete from public.credit_allocations where operation_id in(select id from public.usage_operations where account_id in(select id from public.agent_accounts where engagement_id in(select id from fixture_engagements)));
 delete from public.usage_operations where account_id in(select id from public.agent_accounts where engagement_id in(select id from fixture_engagements));
 delete from public.credit_refunds where purchase_id in(select id from public.credit_purchases where account_id in(select id from public.agent_accounts where engagement_id in(select id from fixture_engagements)));
 delete from public.credit_lots where account_id in(select id from public.agent_accounts where engagement_id in(select id from fixture_engagements));
 delete from public.credit_purchases where account_id in(select id from public.agent_accounts where engagement_id in(select id from fixture_engagements));
 delete from public.agent_configs where engagement_id in(select id from fixture_engagements);
 delete from public.agent_accounts where engagement_id in(select id from fixture_engagements);
 delete from public.engagements where id in(select id from fixture_engagements);
 commit;`);
  for (const id of discovered.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new Error("Fixture account cleanup failed.");
  }
  fs.rmSync(`.integration-runs/${run}.json`, { force: true });
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { ActionForm } from "./action-form";
import { Button } from "./ui/button";
import { freelanceContract } from "@/lib/contracts";
export async function ContractView({
  db,
  id,
  userId,
  selected,
}: {
  db: SupabaseClient;
  id: string;
  userId: string;
  selected?: string;
}) {
  const [state, versions, settings] = await Promise.all([
    db
      .from("engagement_contracts")
      .select("*")
      .eq("engagement_id", id)
      .maybeSingle(),
    db
      .from("contract_versions")
      .select("*")
      .eq("engagement_id", id)
      .order("number", { ascending: false }),
    db
      .from("scope_monitor_settings")
      .select("enabled")
      .eq("engagement_id", id)
      .maybeSingle(),
  ]);
  if (state.error || versions.error || settings.error)
    return (
      <p role="alert" className="notice">
        Contract data could not be loaded. Refresh or check database setup.
      </p>
    );
  const latest = versions.data?.find(
    (v) => v.id === state.data?.latest_version_id,
  );
  const accepted = versions.data?.find(
    (v) => v.id === state.data?.accepted_version_id,
  );
  const approvalHistory = versions.data?.length
    ? await db
        .from("contract_approvals")
        .select("version_id,role,user_id,created_at")
        .in(
          "version_id",
          versions.data.map((v) => v.id),
        )
    : { data: [], error: null };
  const approvals = {
    error: approvalHistory.error,
    data: approvalHistory.data?.filter((a) => a.version_id === latest?.id),
  };
  const enabled = settings.data?.enabled !== false;
  return (
    <div className="stack">
      <section className="panel">
        <h2>Contract</h2>
        <p className="muted mt-3">
          {accepted
            ? `Accepted version ${accepted.number}`
            : "No contract has been accepted yet."}{" "}
          Both parties approve exactly the same version. Accepted milestones
          define the work, price and dates.
        </p>
        {accepted && (
          <details className="mt-4" open>
            <summary className="cursor-pointer font-medium">
              Accepted contract · version {accepted.number}
            </summary>
            <p
              id={`contract-${accepted.id}`}
              className="whitespace-pre-wrap mt-4"
            >
              {accepted.body}
            </p>
          </details>
        )}
        {latest && latest.id !== accepted?.id && (
          <article id={`contract-${latest.id}`} className="border-t mt-5 pt-4">
            <h3>Proposed version {latest.number}</h3>
            <p className="whitespace-pre-wrap mt-3">{latest.body}</p>
            {approvals.error ? (
              <p role="alert">Approval records could not be loaded.</p>
            ) : (
              <p className="muted mt-3">
                Approved by:{" "}
                {approvals.data?.map((a) => a.role).join(", ") ||
                  "Neither party yet"}
              </p>
            )}
            <ActionForm actionName="contract-approve" className="mt-4">
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="version" value={latest.id} />
              <Button
                disabled={
                  !!approvals.error ||
                  approvals.data?.some((a) => a.user_id === userId)
                }
              >
                Approve contract version {latest.number}
              </Button>
            </ActionForm>
          </article>
        )}
      </section>
      <section className="panel">
        <h3>
          {latest ? "Propose a contract revision" : "Prepare your contract"}
        </h3>
        <p className="muted mt-3">
          Edit the shared draft and submit a proposal. Submitting does not
          approve it. Templates are starting points to review and adapt.
        </p>
        <ActionForm actionName="contract-propose" className="stack mt-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="expected" value={latest?.id || ""} />
          <input type="hidden" name="operationKey" value={randomUUID()} />
          <label htmlFor="contract-text">Contract text</label>
          <textarea
            id="contract-text"
            name="body"
            rows={18}
            minLength={20}
            maxLength={20000}
            required
            defaultValue={
              latest?.body || state.data?.initial_body || freelanceContract
            }
            key={latest?.id || "draft"}
          />
          <Button>Submit contract proposal</Button>
        </ActionForm>
      </section>
      <section className="panel">
        <h3>Automatic scope and contract checks</h3>
        <p className="muted my-3">
          {enabled ? "On" : "Paused"}. Shared discussion messages are checked
          after sending against accepted terms only. Checks use shared AI
          tokens, capped at 5 tokens per day and 60 checks. Failed or unusable
          checks are not charged. Private assistants and private tokens are
          excluded. AI notices are advice, not decisions.
        </p>
        <ActionForm actionName="scope-monitor">
          <input type="hidden" name="id" value={id} />
          <input
            type="hidden"
            name="enabled"
            value={enabled ? "false" : "true"}
          />
          <Button variant="outline">
            {enabled
              ? "Pause future automatic checks"
              : "Enable future automatic checks"}
          </Button>
        </ActionForm>
      </section>
      {!!versions.data?.length && (
        <details className="panel" open={!!selected}>
          <summary className="cursor-pointer font-medium">
            Contract version history
          </summary>
          {versions.data.map((v) => {
            const records =
              approvalHistory.data?.filter((a) => a.version_id === v.id) || [];
            return (
              <details key={v.id} className="mt-4" open={selected === v.id}>
                <summary className="cursor-pointer">
                  Version {v.number} ·{" "}
                  {v.id === accepted?.id
                    ? "currently accepted"
                    : records.length === 2
                      ? "previously accepted"
                      : "submitted"}{" "}
                  · {new Date(v.created_at).toISOString().slice(0, 10)}
                </summary>
                {approvalHistory.error ? (
                  <p role="alert">Approval history could not be loaded.</p>
                ) : (
                  <p className="muted text-xs mt-2">
                    Approvals:{" "}
                    {records
                      .map(
                        (a) =>
                          `${a.role} · ${new Date(a.created_at).toISOString()}`,
                      )
                      .join("; ") || "None"}
                  </p>
                )}
                <p
                  id={`contract-archive-${v.id}`}
                  className="whitespace-pre-wrap mt-3"
                >
                  {v.body}
                </p>
              </details>
            );
          })}
        </details>
      )}
    </div>
  );
}

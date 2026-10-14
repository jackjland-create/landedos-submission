import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function repositoryRoot() {
  let candidate = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    if (
      existsSync(join(candidate, "supabase", "migrations")) &&
      existsSync(join(candidate, "apps", "web"))
    )
      return candidate;
    candidate = dirname(candidate);
  }
  throw new Error("Repository root unavailable");
}

function migration(name: string) {
  return readFileSync(
    join(repositoryRoot(), "supabase", "migrations", name),
    "utf8",
  );
}

function repositorySource(path: string) {
  return readFileSync(join(repositoryRoot(), path), "utf8");
}

describe("local devnet review-packet migrations", () => {
  const activation = migration(
    "20260925000100_local_devnet_strategy_activation.sql",
  );
  const execution = migration(
    "20260925000200_local_devnet_campaign_execution.sql",
  );
  const handoff = migration(
    "20260930000100_local_devnet_activation_handoff.sql",
  );

  it("installs the opt-in operator diagnostic only in the temporary session proxy", () => {
    const runner = repositorySource("scripts/run-external-devnet-session.cjs");
    expect(runner).toContain(
      "LANDED_EXTERNAL_ENTRY_DIAGNOSTIC_PATH: entryDiagnosticFile",
    );
    expect(runner).toContain(
      "operatorEntryDiagnosticFile: entryDiagnosticFile",
    );
    expect(runner).toContain(
      "src/lib/attribution/devnet-entry-observation.server",
    );
    expect(runner).toContain(
      "return observeDevnetOperatorEntry(request,()=>updateSession(request));",
    );
    expect(repositorySource("apps/web/src/proxy.ts")).not.toContain(
      "observeDevnetOperatorEntry",
    );
  });

  it("prepares exact private report routes with the accepted fresh baseline and phase-bound report mode", () => {
    const runner = repositorySource("scripts/run-external-devnet-session.cjs");
    for (const source of [
      "src/app/projects/[projectId]/reports/[reportId]/page",
      "src/app/visual-tests/reporting-studio/review/page",
      "src/app/api/isolated-timed-reports/route",
      "src/app/api/projects/[projectId]/reports/[reportVersionId]/evidence/route",
    ])
      expect(runner).toContain(source);
    const reportModes = Array.from(
      runner.matchAll(/LANDED_LOCAL_DEVNET_REPORTS:\s*([^\n]+),/g),
      (match) => match[1],
    );
    expect(reportModes).toHaveLength(2);
    for (const localReviewDiagnostic of [false, true]) {
      expect(runInNewContext(reportModes[0]!, { localReviewDiagnostic })).toBe(
        localReviewDiagnostic ? "1" : "0",
      );
    }
    for (const mode of ["drain", "review"]) {
      expect(runInNewContext(reportModes[1]!, { mode })).toBe(
        mode === "review" ? "1" : "0",
      );
    }
    expect(runner).toContain("const expectedMigrationCount = 98;");
    expect(runner).toContain(
      'const expectedMigrationTip = "20261008000100_exact_devnet_evaluator_v2.sql";',
    );
    expect(runner).toContain("verifyFreshBaseline({");
    const page = repositorySource(
      "apps/web/src/app/projects/[projectId]/campaigns/[campaignId]/page.tsx",
    );
    expect(page).toContain("localDevnetReportEnabled() && devnetJob.success");
    expect(page).toContain("reconciliationJobId: devnetJob.data");
    expect(page).toContain("timing: devnetReviewTiming(campaignId)");
    const cutoffExpression = runner.match(
      /LANDED_LOCAL_DEVNET_REVIEW_DECISIONS_CLOSE_AT:\s*([\s\S]*?),\n\s*\.\.\.\(binding/,
    )?.[1];
    expect(cutoffExpression).toBeTruthy();
    const require = createRequire(import.meta.url);
    const { reviewDecisionsCloseAt } = require(
      join(repositoryRoot(), "scripts/lib/external-devnet-review-boundary.cjs"),
    );
    for (const mode of ["drain", "review"])
      expect(
        runInNewContext(cutoffExpression!, {
          mode,
          binding: { expiresAt: "2026-10-08T02:00:43.719Z" },
          reviewDecisionsCloseAt,
        }),
      ).toBe(mode === "review" ? "2026-10-08T01:58:43.719Z" : "");
  });

  it("checks physically closed owned inputs and one fresh exact job before preparing, never installing, an execution binding", () => {
    const runner = repositorySource("scripts/run-external-devnet-session.cjs");
    const phase = runner.slice(
      runner.indexOf("async function prepareStoppedJoinedReviewBoundary("),
      runner.indexOf("async function restartInputLockedApplication("),
    );
    for (const anchor of [
      "await stopChild(tunnelState)",
      "await revokeExactHostApproval()",
      "docker stop -t 5",
    ])
      expect(phase).toContain(anchor);
    expect(phase.replace(/\s+/g, "")).toContain(
      "(await revokeExactHostApproval()) === true".replace(/\s+/g, ""),
    );
    expect(phase.indexOf("await stopChild(tunnelState)")).toBeLessThan(
      phase.indexOf("await revokeExactHostApproval()"),
    );
    expect(phase.indexOf("await revokeExactHostApproval()")).toBeLessThan(
      phase.indexOf("docker stop -t 5"),
    );
    for (const check of [
      "assertOwnedProcessGroupStopped(tunnelState)",
      "assertOwnedProcessGroupStopped(reconciliationWorkerState)",
      "assertOwnedProcessGroupStopped(applicationState)",
      "await unused(ports.app)",
      "await unused(ports.inngest)",
      "observed.jobCount === 1",
      "activeRuntimeSessions",
      "unfinishedReconciliationJobs",
      "executionAuthorityInstalled: false",
      "reviewRuntimeRestarted: false",
    ])
      expect(phase.replace(/,\s*\)/g, ")").replace(/\s+/g, "")).toContain(
        check.replace(/\s+/g, ""),
      );
    expect(phase).not.toMatch(
      /insert into|grant execute|session_replication_role/i,
    );
    const journal = phase.slice(phase.indexOf("writeJournal({"));
    expect(journal).not.toContain("quiescenceReceipt");
    const require = createRequire(import.meta.url);
    expect(
      typeof require(
        join(
          repositoryRoot(),
          "scripts/lib/external-devnet-review-boundary.cjs",
        ),
      ).prepareClosedReviewBinding,
    ).toBe("function");
  });

  it("accepts reviewed psql command tags around one JSON object and rejects unknown output", () => {
    const require = createRequire(import.meta.url);
    const { parseLastJson } = require(
      join(repositoryRoot(), "scripts", "lib", "psql-output.cjs"),
    ) as { parseLastJson: (value: string) => Record<string, unknown> };

    expect(
      parseLastJson('BEGIN\nINSERT 0 1\n{"state":"ready"}\nCOMMIT\n'),
    ).toEqual({ state: "ready" });
    expect(() => parseLastJson('{"state":"ready"}\nunknown')).toThrow(
      "JSON evidence was malformed.",
    );
    expect(() => parseLastJson('unknown\n{"state":"ready"}\nCOMMIT')).toThrow(
      "JSON evidence was malformed.",
    );
    expect(() => parseLastJson('{"first":1}\n{"second":2}\nCOMMIT')).toThrow(
      "Multiple JSON evidence objects found.",
    );
    expect(() => parseLastJson("BEGIN\nCOMMIT\n")).toThrow(
      "JSON evidence missing.",
    );
  });

  it("contains no provisioning or runtime grant", () => {
    for (const source of [activation, execution, handoff]) {
      expect(source).not.toMatch(/^\s*create\s+(role|database)\b/im);
      expect(source).not.toMatch(/^\s*alter\s+role\b/im);
      expect(source).not.toMatch(/^\s*grant\b/im);
      expect(source).not.toContain("source_epoch");
      expect(source).not.toContain("mainnet");
    }
  });

  it("keeps the V2 exception bound to one future role, database and campaign", () => {
    expect(activation).toContain("'landed_devnet_rehearsal_server'");
    expect(activation).toContain("'landed_wf_devnet_rehearsal_01'");
    expect(activation).toContain(
      "'landed.local_devnet_strategy_link_campaign'",
    );
    expect(activation).toContain(
      "'landed.local_devnet_strategy_transition_campaign'",
    );
    expect(activation).toContain("assert_local_devnet_activation_scope");
    expect(activation).toContain("if retained->>'schemaVersion' = '1' then");
    expect(activation).toContain(
      "raise exception 'Strategy campaign activation is not yet enabled'",
    );
    expect(activation).not.toContain(
      "create or replace function public.assert_legacy_campaign_operations",
    );
    expect(activation).not.toContain("from public.issue_tracked_link(");
    expect(activation).not.toContain("from public.transition_campaign_state(");
    expect(activation).toContain("public.assert_legacy_campaign_operations(");
    expect(activation).toContain("'^https://[^/?#]+/measure$'");
    expect(activation).toContain(
      "rule.native_amount_lamports is distinct from 1",
    );
    expect(activation).toContain("'live'::public.campaign_status");
    expect(
      activation.match(/Original local devnet activation authority expired/g),
    ).toHaveLength(2);
  });

  it("derives execution from one completed exact reconciliation", () => {
    expect(execution).toContain("local_devnet_execution_capabilities");
    expect(execution).toContain("assert_local_devnet_execution_scope");
    expect(execution).toContain("job.status <> 'completed'");
    expect(execution).toContain("job.configured_environment <> 'devnet'");
    expect(execution).toContain("job.normalization_issue_count <> 0");
    expect(execution).toContain(
      "job.range_started_at is distinct from start_at",
    );
    expect(execution).toContain("job.range_ended_at is distinct from end_at");
    expect(execution).toContain("solana_reconciliation_job_deliveries");
    expect(execution).toContain("canonical_chain_event_sources");
    expect(execution).toContain(
      "source.canonical_chain_event_id = canonical.id",
    );
    expect(execution).toContain(
      "linked_delivery.delivery_id = observed_raw.delivery_id",
    );
    expect(execution).toContain("public.load_campaign_conversion_candidate(");
    expect(execution).toContain("public.preview_campaign_execution(");
    expect(execution).toContain("public.approve_campaign_execution(");
    expect(execution).toContain("public.execute_reviewed_campaign_execution(");
  });

  it("separates pre-action authority from post-reconciliation execution authority", () => {
    expect(activation).toContain("local_devnet_activation_capabilities");
    expect(activation).not.toContain("local_devnet_execution_capabilities");
    expect(execution).toContain("local_devnet_execution_capabilities");
    expect(execution).toContain("reconciliation_job_id");
    expect(execution).toContain(
      "job.completed_at > capability.inputs_quiesced_at",
    );

    const postExecution = execution.slice(
      execution.indexOf("perform public.execute_reviewed_campaign_execution("),
    );
    expect(postExecution).not.toContain(
      "public.load_local_devnet_reconciliation_candidate(",
    );
    expect(postExecution).toContain(
      "Exact reviewed execution receipt was not retained",
    );
    expect(
      execution.match(/Original local devnet execution authority expired/g),
    ).toHaveLength(2);
  });

  it("keeps every prepared surface revoked pending a separate grant decision", () => {
    for (const signature of [
      "issue_local_devnet_strategy_tracked_link",
      "transition_local_devnet_strategy_campaign_live",
      "prepare_local_devnet_campaign_execution",
      "read_local_devnet_campaign_execution",
      "confirm_local_devnet_campaign_execution",
    ]) {
      expect(`${activation}\n${execution}`).toMatch(
        new RegExp(`revoke all on function public\\.${signature}`),
      );
    }
    expect(handoff).toContain(
      "revoke all on function public.read_local_devnet_activation_handoff",
    );
    expect(handoff).not.toMatch(/^\s*grant\b/im);
  });

  it("requires a fresh exact rule and a human-reviewed campaign handoff", () => {
    expect(handoff).toContain("local_devnet_commercial_capabilities");
    expect(handoff).toContain("rule.created_at < capability.created_at");
    expect(handoff).toContain(
      "rule.destination_address is distinct from capability.receiver_address",
    );
    expect(handoff).toContain("rule.native_amount_lamports is distinct from 1");
    expect(handoff).toContain("public.assert_local_browser_campaign_scope");
    expect(handoff).toContain("public.create_campaign_from_strategy_plan");
    expect(handoff).toContain("Approve the latest campaign brief");
    expect(handoff).toContain("Issue each participant tracking link");
    expect(handoff).toContain("guard_local_devnet_live_timing");
    expect(handoff).toContain("Re-approve the exact tracking destination host");
    expect(handoff).toContain(
      "Approved tracking destination is no longer active",
    );
    expect(handoff).toContain("destination.revoked_at is null");
    expect(handoff).not.toContain("configure_conversion_rule_version_v2(");
    expect(handoff).not.toContain("disable trigger");
  });

  it("keeps provider creation behind the exact retained live-campaign gate", () => {
    const runner = repositorySource("scripts/run-external-devnet-session.cjs");
    const capabilityCall = runner.lastIndexOf("openExactCommercialCapability(");
    const liveRead = runner.lastIndexOf(
      "const liveCampaign = await waitForExactActivation({",
    );
    const activationGuard = runner.indexOf(
      'if (liveCampaign.state !== "ready")',
      liveRead,
    );
    const providerCreate = runner.indexOf(
      "const providerCreated = await createWebhook(",
    );

    expect(capabilityCall).toBeGreaterThan(0);
    expect(liveRead).toBeGreaterThan(capabilityCall);
    expect(activationGuard).toBeGreaterThan(liveRead);
    expect(providerCreate).toBeGreaterThan(activationGuard);
    expect(runner.slice(liveRead, activationGuard)).toContain(
      "read: readExactLiveCampaignHandoff",
    );
    expect(runner.slice(liveRead, activationGuard)).toContain(
      "deadlineMs: humanDecisionDeadline",
    );
    expect(runner).toContain(
      'providerState: "not_created_before_campaign_activation"',
    );
    expect(runner).toContain(
      'const dbName = "landed_devnet_rehearsal01_externalbaseline10_db"',
    );
    expect(runner).toContain('const expectedSubnet = "10.254.2.0/24"');
    expect(runner).toContain("networkIpam.length === 1");
    expect(runner).toContain("networkIpam[0]?.Subnet === expectedSubnet");
    expect(runner).toContain(
      '"80e9f57eb89cd15d109991a14ae305cc464587e9184829562b0780fcbb4bf41b"',
    );
    expect(runner).toContain('process.argv[2] === "--verify-pin-only"');
    expect(
      repositorySource("scripts/lib/external-devnet-baseline-proof.cjs"),
    ).toContain("sha256");
    expect(runner).toContain("'decisionCounts',jsonb_build_object(");
    expect(runner).toContain("Object.values(baseline.decisionCounts).every(");
    expect(runner).toContain("'authorityCounts',jsonb_build_object(");
    expect(runner).toContain("baseline.adminPasswordBlank === true");
    expect(runner).toContain("baseline.authorityCounts?.authUsers === 1");
    expect(runner).toContain("baseline.authorityCounts?.authSessions === 0");
    expect(runner).toContain('adminAuthBaseline.encryptedPassword === ""');
    expect(runner).toContain("adminAuthBaseline.sessionIds.length === 0");
    expect(runner).toContain("createRetainedDatabaseSnapshot();");
    expect(runner).toContain("restoreRetainedDatabaseSnapshot();");
    expect(runner).toContain("verifyRestoredDecisionBaseline();");
    expect(runner).toContain(
      "pg_dump -U postgres -d ${database} --data-only --format=custom",
    );
    expect(runner).toContain(
      "pg_restore --data-only --disable-triggers --file=- ${retainedDatabaseSnapshot}",
    );
    // The retained repair now restores extracted SQL inside one owner-side
    // transaction; do not require the superseded non-atomic pg_restore path.
    expect(runner).toContain("ownerSql(`begin;\\ndo $$");
    expect(runner).toContain("${restoreSql}\\ncommit;");
    expect(runner).toContain(
      "truncate table '||targets||' restart identity cascade",
    );
    expect(runner).toContain(
      '"Schema changed before retained data restoration."',
    );
    expect(runner).toContain('databaseSnapshotState: "verified_and_removed"');
    expect(runner).toContain(
      "(!databaseSnapshotCreated || databaseSnapshotRestored)",
    );
    expect(runner).toContain("restrictedRoleRestored &&");
    expect(runner).toContain("databaseSnapshotRemoved;");
    expect(runner).toContain(
      'const approvedTestCreatorId = "40990000-0000-4000-8000-000000000001"',
    );
    expect(runner).toContain("'approvedInputs',jsonb_build_object(");
    expect(runner).toContain("baseline.approvedInputs?.creatorCount === 1");
    expect(runner).toContain(
      "baseline.approvedInputs?.creatorRateQuoteCount === 0",
    );
    expect(runner).toContain(
      "baseline.approvedInputs?.creator?.displayName ===",
    );
    expect(runner).toContain(
      'localApprovalRedirect.searchParams.get("next") ===',
    );
    expect(runner).toContain("expectedLocalApprovalReturnPath");
    expect(runner.match(/d\.deptype in\('a','i'\)/g)).toHaveLength(2);
    expect(
      runner.match(/order by case when c\.relkind in\('r','p'\)/g),
    ).toHaveLength(2);
    expect(runner).toContain(
      'campaignActivationState: "exact_live_handoff_verified"',
    );
    expect(runner).toContain('ENABLE_BASKET_TIMING: "1"');
    expect(runner).toContain('GOTRUE_DB_MAX_POOL_SIZE: "4"');
    expect(runner).toContain('GOTRUE_DB_MAX_IDLE_POOL_SIZE: "4"');
    expect(runner).toContain("connection limit 6;");
    expect(runner).toContain(
      "nologin password null connection limit -1 inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;",
    );
    expect(runner).toContain(
      "assertBaselineAuthRoleAudit(readBaselineAuthRoleAudit());",
    );
    expect(runner).toContain(
      "NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME: `landed-external-${runOwner}`",
    );
    expect(runner).toContain("`http://localhost:${ports.app}`");
    expect(runner).toContain('"app/api/projects/[projectId]/baskets/route.ts"');
    expect(runner).toContain(
      'require("./lib/external-devnet-route-manifest.cjs").assertJourneyManifest(',
    );
    expect(runner).toContain('"/api/projects/helios/baskets"');
    expect(runner).toContain(
      '"Public gate failed closed for the basket creation action."',
    );
    expect(runner).toContain("ownerSqlBeforeDeadline(");
    expect(runner).toContain(
      "openExactCommercialCapability(\n    humanDecisionDeadline,\n    hostApproval",
    );
    expect(runner).toContain("live_handoff_read_timed_out");
    expect(runner).toContain("decision_window_expired_after_live_read");
    expect(runner).toContain("decision_window_expired_before_provider");
    expect(runner).toContain("decision_window_expired_at_provider_boundary");
    expect(runner).toContain(
      "createWebhook(\n    apiKey,\n    webhookAuthorization,\n    Date.parse(liveWindow.endsAt)",
    );
    expect(runner).toContain("approvalDeadlineMs: humanDecisionDeadline");
    expect(runner).toContain(
      "capabilityExpiresAt: commercialCapability.expiresAt",
    );
    expect(runner).toContain(
      "measurementEndsAt: liveCampaign.measurementEndsAt",
    );
    expect(runner).toContain(
      "credentialDeadlineMs: runtimeCredentialDeadlineMs",
    );
    expect(runner).toContain("const liveWindow = liveSessionWindow({");
    expect(runner).toContain("if (liveWindow.remainingMs <= 0) return;");
    expect(
      runner.indexOf("const liveWindow = liveSessionWindow({"),
    ).toBeLessThan(providerCreate);
    expect(
      runner.indexOf("if (liveWindow.remainingMs <= 0) return;"),
    ).toBeLessThan(providerCreate);
    expect(
      runner.indexOf("decision_window_expired_before_provider"),
    ).toBeLessThan(providerCreate);
    expect(runner).toContain('"app/api/isolated-devnet-rehearsal/route.ts"');
    expect(runner).toContain(
      '"app/projects/[projectId]/campaigns/[campaignId]/page.tsx"',
    );
  });

  it("prepares a retained decision-clean baseline without replaying human decisions", () => {
    const provisioner = repositorySource(
      "scripts/verify-local-devnet-rehearsal.cjs",
    );

    expect(provisioner).toContain("LANDED_LOCAL_DEVNET_BASELINE_ONLY");
    expect(provisioner).toContain("LANDED_LOCAL_DEVNET_NETWORK_SUBNET");
    expect(provisioner).toContain(
      'throw new Error("Invalid explicit local rehearsal network subnet.")',
    );
    expect(provisioner).toContain(
      'scope: baselineOnly\n    ? "isolated_external_devnet_baseline_preparation"',
    );
    expect(provisioner).toContain("humanInputsRetained: 1");
    expect(provisioner).toContain("approvedInputProofPath");
    expect(provisioner).toContain("retainedBaseline.creatorCount !== 1");
    expect(provisioner).toContain("'adminPasswordBlank'");
    expect(provisioner).toContain("'authSessionCount'");
    expect(provisioner).toContain("'workspaceMemberCount'");
    expect(provisioner).toContain(
      "retainedBaseline.adminPasswordBlank !== true",
    );
    expect(provisioner).toContain("providerRequests: 0");
    expect(provisioner).toContain("walletActions: 0");
    expect(provisioner).toContain(
      'sourceClassification: baselineOnly\n    ? "local external-session readiness baseline only"',
    );
    expect(provisioner).toContain(
      '"External-session baseline was not decision-clean."',
    );
    expect(provisioner).toContain(
      '"SHA-256 of schema-only pg_dump with PostgreSQL restrict wrappers removed"',
    );
  });
});

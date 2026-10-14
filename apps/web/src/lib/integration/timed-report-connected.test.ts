// @vitest-environment node
// INT-01 / BSK-09: opt-in isolated Auth/REST read proof with a PRIVATE OWNER-SQL
// test bridge. This is not a runtime issuer or browser/live-chain demonstration.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  timedCampaignReportReviewSchema,
  type ContractedCostReview,
} from "@landed/analytics";
import { getProjectReport } from "@landed/db";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { calculateTimedReportReview } from "../reports/timed-report-calculation.server";

const enabled = process.env.LANDED_TIMED_REPORT_INTEGRATION === "1";
const actor = "30990000-0000-4000-8000-000000000001";
const outsiderId = "30990000-0000-4000-8000-000000000003";
const workspace = "10990000-0000-4000-8000-000000000001";
const project = "20990000-0000-4000-8000-000000000001";
const execution = "90990000-0000-4000-8000-000000000300";
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
type PrivateCall =
  | { kind: "bundle"; campaign: string }
  | {
      kind: "approve";
      calculation: ReturnType<typeof calculateTimedReportReview>;
      reason: string;
    }
  | { kind: "issue"; approval: string };

describe.skipIf(!enabled)("timed report isolated connected rehearsal", () => {
  it("authenticates readers, privately calculates/approves/issues, and reads the immutable result through RLS", async () => {
    const database = process.env.LANDED_TIMED_REPORT_DATABASE ?? "";
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (
      !/^landed_wf_verify_http_[a-z0-9_]+$/.test(database) ||
      url !== "http://127.0.0.1:55421" ||
      !publicKey ||
      !serviceKey
    )
      throw new Error(
        "Requires the explicitly isolated loopback HTTP verification harness.",
      );
    const service = createClient(url, serviceKey, options);
    const manager = createClient(url, publicKey, options);
    const outsider = createClient(url, publicKey, options);
    const anonymous = createClient(url, publicKey, options);
    async function signIn(client: SupabaseClient, id: string, email: string) {
      const password = randomUUID();
      const updated = await service.auth.admin.updateUserById(id, {
        email,
        password,
        email_confirm: true,
      });
      expect(updated.error).toBeNull();
      expect(updated.data.user?.id).toBe(id);
      const signed = await client.auth.signInWithPassword({ email, password });
      expect(signed.error).toBeNull();
      expect(signed.data.user?.id).toBe(id);
      const checked = await client.auth.getUser();
      expect(checked.error).toBeNull();
      expect(checked.data.user?.id).toBe(id);
    }
    await signIn(manager, actor, "bsk09-1@example.test");
    await signIn(outsider, outsiderId, "bsk09-3@example.test");

    // No generic SQL or function name is accepted. The owner credential lives
    // only in existing local VM infrastructure, not the application/client.
    async function privateOwnerCall(call: PrivateCall): Promise<unknown> {
      const authenticated = await manager.auth.getUser();
      if (authenticated.error || authenticated.data.user?.id !== actor)
        throw new Error("Fresh authenticated rehearsal actor required.");
      let expression: string;
      switch (call.kind) {
        case "bundle":
          expression = `public.load_timed_report_evidence_bundle(${literal(workspace)}::uuid,${literal(project)}::uuid,${literal(z.uuid().parse(call.campaign))}::uuid,${literal(execution)}::uuid)`;
          break;
        case "approve":
          if (call.calculation.identity.requestedBy !== actor)
            throw new Error(
              "Calculation actor differs from authenticated reader.",
            );
          expression = `public.approve_timed_campaign_report(${literal(JSON.stringify(call.calculation))}::jsonb,${literal(call.reason)})`;
          break;
        case "issue":
          expression = `public.issue_approved_timed_campaign_report(${literal(z.uuid().parse(call.approval))}::uuid)`;
          break;
      }
      const result = spawnSync(
        "ssh",
        [
          "-F",
          "/dev/null",
          "-S",
          "/private/tmp/landed-local-runtime.QAg14K/instances/landed-test/ssh.sock",
          "-o",
          "BatchMode=yes",
          "-o",
          "ControlMaster=no",
          "-p58490",
          "lima@127.0.0.1",
          "docker",
          "exec",
          "-i",
          "supabase_db_landed-kol-os",
          "psql",
          "-X",
          "-U",
          "postgres",
          "-d",
          database,
          "-v",
          "ON_ERROR_STOP=1",
          "-qAt",
          "-f",
          "-",
        ],
        {
          input: `begin;\nset local standard_conforming_strings=on;\nset local statement_timeout='15000ms';\nselect set_config('request.jwt.claim.sub',${literal(authenticated.data.user.id)},true);\nselect 'PRIVATE_RESULT|' || (${expression})::text;\ncommit;\n`,
          encoding: "utf8",
          maxBuffer: 32 * 1024 * 1024,
          timeout: 20_000,
        },
      );
      if (result.status !== 0)
        throw new Error(
          "Isolated private SQL bridge failed; source payload withheld.",
        );
      const lines = result.stdout
        .split("\n")
        .filter((line) => line.startsWith("PRIVATE_RESULT|"));
      if (lines.length !== 1)
        throw new Error("Private result envelope is incomplete.");
      return JSON.parse(lines[0]!.slice("PRIVATE_RESULT|".length));
    }

    const campaignRows = await manager
      .from("campaigns")
      .select("id")
      .eq("project_id", project);
    expect(campaignRows.error).toBeNull();
    const campaign = z
      .array(z.object({ id: z.uuid() }))
      .length(1)
      .parse(campaignRows.data)[0]!.id;
    const bundle = await privateOwnerCall({ kind: "bundle", campaign });
    const source = z
      .object({
        evidence: z.object({
          executionReview: z.object({
            reportReview: timedCampaignReportReviewSchema,
          }),
        }),
      })
      .parse(bundle).evidence.executionReview.reportReview.reportSources;
    const costs: ContractedCostReview = {
      workspaceId: source.workspaceId,
      projectId: source.projectId,
      campaignId: source.campaignId,
      commercialPlanVersionId: source.commercialPlanVersionId,
      commercialPlanSnapshotHash: source.commercialPlanSnapshotHash,
      ruleVersionId: source.ruleVersionId,
      measurementWindow: source.measurementWindow,
      policy: { basis: "contracted", version: 1 },
      currencyCode: "GBP",
      additionalCosts: "none_declared",
      decisions: source.commercialPlanSnapshot.packages.flatMap((p) =>
        p.compensationLines.map((line) => ({
          compensationLineId: line.id,
          inclusion: "included" as const,
          reason: "Synthetic human reviewed agreed campaign compensation",
        })),
      ),
    };
    const identity = {
      reportApprovalId: randomUUID(),
      executionApprovalId: execution,
      reportId: randomUUID(),
      reportVersionId: randomUUID(),
      metricSnapshotId: randomUUID(),
      issueRequestId: randomUUID(),
      requestedBy: actor,
    };
    const calculation = calculateTimedReportReview(bundle, costs, identity);
    const reason =
      "Synthetic authorized human review of contracted costs and closed measurement.";
    expect(
      await privateOwnerCall({ kind: "approve", calculation, reason }),
    ).toMatchObject({ inserted: true, approvalId: identity.reportApprovalId });
    expect(
      await privateOwnerCall({ kind: "approve", calculation, reason }),
    ).toMatchObject({ inserted: false });
    expect(
      await privateOwnerCall({
        kind: "issue",
        approval: identity.reportApprovalId,
      }),
    ).toMatchObject({
      inserted: true,
      reportVersionId: identity.reportVersionId,
      version: 1,
    });
    expect(
      await privateOwnerCall({
        kind: "issue",
        approval: identity.reportApprovalId,
      }),
    ).toMatchObject({
      inserted: false,
      reportVersionId: identity.reportVersionId,
      version: 1,
    });

    // Existing DB reader validates reportPayloadSchema, metric schema and their
    // scope/identity agreement through genuine authenticated PostgREST reads.
    const report = await getProjectReport(manager, project, identity.reportId);
    expect(report?.campaignId).toBe(campaign);
    expect(report?.versions).toHaveLength(1);
    expect(report?.versions[0]?.metricSnapshot).toEqual(
      calculation.metricSnapshot,
    );
    expect(report?.versions[0]?.issuedBy).toBe(actor);
    expect(
      await getProjectReport(outsider, project, identity.reportId),
    ).toBeNull();
    for (const client of [manager, outsider, anonymous, service]) {
      const denied = await client.rpc("issue_approved_timed_campaign_report", {
        target_approval_id: identity.reportApprovalId,
      });
      expect(denied.error).not.toBeNull();
    }
    const forbidden = await manager.from("timed_report_approvals").select("id");
    expect(forbidden.error).not.toBeNull();
    await manager.auth.signOut();
    await expect(
      privateOwnerCall({ kind: "issue", approval: identity.reportApprovalId }),
    ).rejects.toThrow("Fresh authenticated");
    await outsider.auth.signOut();
  }, 120_000);
});

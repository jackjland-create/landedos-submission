// @vitest-environment node
// Genuine local Auth/REST + private owner-SQL reader. No runtime grants or issuer.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getProjectReport } from "@landed/db";
import { expect, it, describe } from "vitest";
import { z } from "zod";
import {
  loadTimedReportClarityDetails as loadTimedReportClarity,
  type PrivateTimedPresentationReader,
} from "../reports/timed-report-presentation.server";

const enabled = process.env.LANDED_TIMED_PRESENTATION_INTEGRATION === "1";
const managerId = "30990000-0000-4000-8000-000000000001";
const outsiderId = "30990000-0000-4000-8000-000000000003";
const workspaceId = "10990000-0000-4000-8000-000000000001";
const projectId = "20990000-0000-4000-8000-000000000001";
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
describe.skipIf(!enabled)("isolated issued timed report presentation", () => {
  it("reads the retained issued context as an authenticated reader and rejects unauthorized scope", async () => {
    const database = process.env.LANDED_TIMED_REPORT_DATABASE;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (
      database !== "landed_wf_verify_http_20260921_timed02" ||
      url !== "http://127.0.0.1:55421" ||
      !key ||
      !serviceKey
    )
      throw new Error("Exact isolated existing-consumer harness required.");
    const service = createClient(url, serviceKey, options);
    const manager = createClient(url, key, options);
    const outsider = createClient(url, key, options);
    async function signIn(client: SupabaseClient, id: string, email: string) {
      const password = randomUUID();
      const update = await service.auth.admin.updateUserById(id, {
        email,
        password,
        email_confirm: true,
      });
      expect(update.error).toBeNull();
      const result = await client.auth.signInWithPassword({ email, password });
      expect(result.error).toBeNull();
      expect(result.data.user?.id).toBe(id);
    }
    await signIn(manager, managerId, "bsk09-1@example.test");
    await signIn(outsider, outsiderId, "bsk09-3@example.test");
    function bridge(client: SupabaseClient): PrivateTimedPresentationReader {
      return async (request) => {
        const auth = await client.auth.getUser();
        if (
          auth.error ||
          !auth.data.user ||
          auth.data.user.id !== request.authenticatedActorId
        )
          throw new Error("Authenticated presentation reader required.");
        const args = [
          request.workspaceId,
          request.projectId,
          request.reportId,
          request.reportVersionId,
        ]
          .map((value) => `${quote(z.uuid().parse(value))}::uuid`)
          .join(",");
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
            database!,
            "-v",
            "ON_ERROR_STOP=1",
            "-qAt",
            "-f",
            "-",
          ],
          {
            input: `begin read only;\nset local standard_conforming_strings=on;\nset local statement_timeout='15000ms';\nselect set_config('request.jwt.claim.sub',${quote(z.uuid().parse(auth.data.user.id))},true);\nselect 'PRESENTATION|' || public.load_issued_timed_report_details(${args})::text;\ncommit;\n`,
            encoding: "utf8",
            maxBuffer: 4 * 1024 * 1024,
            timeout: 20000,
          },
        );
        if (result.status !== 0)
          throw new Error("Private presentation read denied.");
        const rows = result.stdout
          .split("\n")
          .filter((line) => line.startsWith("PRESENTATION|"));
        if (rows.length !== 1)
          throw new Error("Private presentation unavailable.");
        return JSON.parse(rows[0]!.slice("PRESENTATION|".length));
      };
    }
    const rows = await manager
      .from("reports")
      .select("id")
      .eq("project_id", projectId);
    expect(rows.error).toBeNull();
    const reportId = z
      .array(z.object({ id: z.uuid() }))
      .length(1)
      .parse(rows.data)[0]!.id;
    const report = await getProjectReport(manager, projectId, reportId);
    expect(report?.versions).toHaveLength(1);
    const request = {
      workspaceId,
      projectId,
      reportId,
      reportVersionId: report!.versions[0]!.id,
    };
    const actual = await loadTimedReportClarity(
      manager,
      bridge(manager),
      request,
    );
    expect(actual.fixture.selectedVersion.metricSnapshot).toEqual(
      report!.versions[0]!.metricSnapshot,
    );
    expect(actual.timedContext.costPolicy).toMatchObject({
      basis: "contracted",
      paid: false,
    });
    expect(actual.timedContext.unavailableMetrics).toEqual([
      "activation",
      "protocolRevenue",
      "impressions",
    ]);
    const safe = JSON.stringify(actual);
    const economics = actual.economics[actual.fixture.selectedVersion.version]!;
    expect(economics.allocatedSpendMinor).toBe("519500");
    expect(economics.unallocatedSpendMinor).toBe("0");
    expect(economics.creators).toHaveLength(2);
    expect(actual.fixture.rankingEvidencePaths).toHaveLength(2);
    for (const creator of economics.creators) {
      expect(creator.creatorName).toBe(`Creator ${creator.creatorId}`);
      expect(creator.creatorHandle).toBeNull();
      expect(creator.contentAssets).toEqual([]);
      expect(creator.activatedWallets).toBeNull();
    }
    for (const field of [
      "sourceHash",
      "calculationHash",
      "approvedBy",
      "issuedBy",
      "payloadSha256",
      "metricSnapshotSha256",
      "protected_wallet_mappings",
      "authenticatedActorId",
      "protectedWalletMappingId",
      "walletAddress",
      "proofSignature",
      "nonce",
      "rawPayload",
    ])
      expect(safe).not.toContain(`"${field}"`);
    await expect(
      loadTimedReportClarity(outsider, bridge(outsider), request),
    ).rejects.toThrow("Report access required");
    await expect(
      bridge(outsider)({ ...request, authenticatedActorId: outsiderId }),
    ).rejects.toThrow("Private presentation read denied");
    await expect(
      bridge(manager)({ ...request, authenticatedActorId: outsiderId }),
    ).rejects.toThrow("Authenticated presentation reader required");
    await expect(
      bridge(manager)({
        ...request,
        reportVersionId: randomUUID(),
        authenticatedActorId: managerId,
      }),
    ).rejects.toThrow("Private presentation read denied");
    await expect(
      bridge(manager)({
        ...request,
        workspaceId: randomUUID(),
        authenticatedActorId: managerId,
      }),
    ).rejects.toThrow("Private presentation read denied");
    for (const client of [
      manager,
      outsider,
      service,
      createClient(url, key, options),
    ]) {
      const denied = await client.rpc("load_issued_timed_report_details", {
        target_workspace_id: workspaceId,
        target_project_id: projectId,
        target_report_id: reportId,
        target_version_id: request.reportVersionId,
      });
      expect(denied.error).not.toBeNull();
    }
    const path = process.env.LANDED_TIMED_PRESENTATION_EXPORT;
    if (path) {
      if (path !== "/private/tmp/landed-timed-report-clarity.json")
        throw new Error("Unexpected presentation artifact path.");
      writeFileSync(path, JSON.stringify(actual, null, 2) + "\n", {
        mode: 0o600,
      });
    }
    await manager.auth.signOut();
    await expect(
      loadTimedReportClarity(manager, bridge(manager), request),
    ).rejects.toThrow("Report access required");
    await outsider.auth.signOut();
  }, 120000);
});

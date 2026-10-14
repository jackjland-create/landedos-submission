// @vitest-environment node
// INT-01 / RPT-03: retained synthetic report consumer, read through genuine
// local Auth/PostgREST. This test never issues, retries, unlinks, evaluates or
// mutates evidence.
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { getProjectReport, getProjectReportEvidence } from "@landed/db";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const enabled = process.env.LANDED_ATTRIBUTION_JOURNEY_INTEGRATION === "1";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  project: "20000000-0000-4000-8000-000000000001",
  manager: "f1000000-0000-4000-8000-000000000001",
  report: "f2100000-0000-4000-8000-000000000001",
  sqlFixtureAttribution: "f3900000-0000-4000-8000-000000000001",
  sqlFixtureCanonicalEvent: "f3500000-0000-4000-8000-000000000001",
} as const;

const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

describe.skipIf(!enabled)("retained attribution journey consumer", () => {
  it("reads one retained creator-to-report path without protected identity access", async () => {
    const database = process.env.LANDED_ATTRIBUTION_JOURNEY_DATABASE;
    const exportPath = process.env.LANDED_ATTRIBUTION_JOURNEY_EXPORT;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (
      database !== "landed_wf_verify_http_20260921_timed02" ||
      url !== "http://127.0.0.1:55421" ||
      exportPath !== "/private/tmp/landed-attribution-journey.json" ||
      !key ||
      process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      throw new Error("Exact retained read-only attribution harness required.");
    }

    const manager = createClient(url, key, options);
    const anonymous = createClient(url, key, options);
    const signedIn = await manager.auth.signInWithPassword({
      email: "int01-manager@example.test",
      password: "int01-golden-password",
    });

    try {
      expect(signedIn.error).toBeNull();
      expect(signedIn.data.user?.id).toBe(ids.manager);

      const report = await getProjectReport(manager, ids.project, ids.report);
      expect(report?.workspaceId).toBe(ids.workspace);
      expect(report?.versions.map(({ version }) => version)).toEqual([3, 2, 1]);
      const issued = report!.versions.find(({ version }) => version === 2)!;
      expect(issued.attributionModel).toBe("last_eligible_creator_touch");
      expect(issued.attributionWindowSeconds).toBe(604800);
      expect(issued.metricSnapshot.metrics.cpc.denominator).toMatchObject({
        status: "available",
        value: 1,
      });
      expect(issued.metricSnapshot.metrics.cpqw.denominator).toMatchObject({
        status: "available",
        value: 1,
      });
      expect(issued.metricSnapshot.metrics.cpa.denominator).toMatchObject({
        status: "available",
        value: 1,
      });

      const [qualifiedWallets, activatedWallets] = await Promise.all([
        getProjectReportEvidence(
          manager,
          ids.project,
          issued.id,
          "qualified_wallets",
        ),
        getProjectReportEvidence(
          manager,
          ids.project,
          issued.id,
          "activated_wallets",
        ),
      ]);
      expect(qualifiedWallets).toHaveLength(1);
      expect(activatedWallets).toHaveLength(1);
      const path = qualifiedWallets[0]!;
      const { metric: qualifiedMetric, ...qualifiedPath } = path;
      const { metric: activatedMetric, ...activatedPath } =
        activatedWallets[0]!;
      expect(qualifiedMetric).toBe("qualified_wallets");
      expect(activatedMetric).toBe("activated_wallets");
      expect(activatedPath).toEqual(qualifiedPath);
      expect(path).toMatchObject({
        reportVersionId: issued.id,
        metricSnapshotId: issued.metricSnapshot.id,
        confidence: "strong",
        primaryRoasEligible: true,
        attributionModel: "last_eligible_creator_touch",
        attributionWindowSeconds: 604800,
        clickQuality: "qualified",
        walletProofState: "signed_nonce_and_consent",
        conversionRuleTemplate: "first_qualifying_transaction",
        conversionEvaluatorVersion: 1,
        valueKind: "native_lamports",
        rawAmount: "1",
        decimals: 9,
        finality: "finalized",
        eventName: "solana.native_transfer",
        environment: "demo",
      });
      expect(path.attributionFactId).not.toBe(ids.sqlFixtureAttribution);
      expect(path.canonicalChainEventId).not.toBe(ids.sqlFixtureCanonicalEvent);
      const elapsed =
        Date.parse(path.conversionTime) - Date.parse(path.touchTime);
      expect(elapsed).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(604800 * 1000);
      expect(path.eventTime).toBe(path.conversionTime);

      const click = await manager
        .from("click_events")
        .select(
          "id, tracked_link_id, campaign_id, creator_id, content_asset_id, signature_valid, eligibility, requested_at",
        )
        .eq("id", path.clickEventId)
        .single();
      expect(click.error).toBeNull();
      expect(click.data).toMatchObject({
        id: path.clickEventId,
        campaign_id: report!.campaignId,
        creator_id: path.creatorId,
        content_asset_id: path.contentAssetId,
        signature_valid: true,
        eligibility: "eligible",
      });
      expect(new Date(click.data!.requested_at).toISOString()).toBe(
        path.touchTime,
      );

      const link = await manager
        .from("tracked_links")
        .select("id, campaign_id, creator_id, content_asset_id, revoked_at")
        .eq("id", z.uuid().parse(click.data!.tracked_link_id))
        .single();
      expect(link.error).toBeNull();
      expect(link.data).toMatchObject({
        campaign_id: report!.campaignId,
        creator_id: path.creatorId,
        content_asset_id: path.contentAssetId,
        revoked_at: null,
      });

      const quality = await manager
        .from("click_quality_assessments")
        .select("click_event_id, outcome")
        .eq("click_event_id", path.clickEventId)
        .single();
      expect(quality.error).toBeNull();
      expect(quality.data).toEqual({
        click_event_id: path.clickEventId,
        outcome: "qualified",
      });

      const canonical = await manager
        .from("canonical_chain_events")
        .select(
          "id, raw_chain_event_id, configured_environment, event_name, transaction_signature, finality, event_time, native_amount_lamports",
        )
        .eq("id", path.canonicalChainEventId)
        .single();
      expect(canonical.error).toBeNull();
      expect(canonical.data).toMatchObject({
        id: path.canonicalChainEventId,
        configured_environment: "demo",
        event_name: "solana.native_transfer",
        transaction_signature: path.transactionSignature,
        finality: "finalized",
        native_amount_lamports: 1,
      });
      expect(new Date(canonical.data!.event_time).toISOString()).toBe(
        path.eventTime,
      );
      expect(path.eventTime).toBe(path.conversionTime);

      const rule = await manager
        .from("conversion_rule_versions")
        .select(
          "id, version, template_code, minimum_finality, attribution_window_seconds, attribution_model, evidence_capability",
        )
        .eq("id", path.conversionRuleVersionId)
        .single();
      expect(rule.error).toBeNull();
      expect(rule.data).toMatchObject({
        id: path.conversionRuleVersionId,
        version: path.conversionRuleVersion,
        template_code: "first_qualifying_transaction",
        minimum_finality: "finalized",
        attribution_window_seconds: 604800,
        attribution_model: "last_eligible_creator_touch",
        evidence_capability: "ready",
      });

      const protectedReads = await Promise.all([
        manager.from("protected_wallet_mappings").select("id").limit(1),
        manager.from("wallet_session_proofs").select("id").limit(1),
        manager.from("wallet_measurement_consents").select("id").limit(1),
        manager.from("wallet_mapping_unlink_events").select("id").limit(1),
        manager.from("raw_chain_events").select("id").limit(1),
      ]);
      for (const denied of protectedReads) expect(denied.error).not.toBeNull();
      await expect(
        getProjectReport(anonymous, ids.project, ids.report),
      ).rejects.toThrow("Issued report could not be loaded");

      const manifest = {
        schemaVersion: 1,
        connectedProofTaskIds: ["INT-01", "RPT-03"],
        scope: "retained_synthetic_report_consumer",
        sourceClassification: {
          click:
            "retained eligible click read through authenticated project access; historical producer not re-proven here",
          wallet:
            "retained report proof state says signed nonce and consent; protected identity is not read",
          chain:
            "retained demo canonical event from the prior sanitized synthetic harness",
          finality:
            "retained finalized state originated from a mocked RPC response in the prior harness",
          report:
            "immutable retained version 2 read through the application database adapter",
        },
        report: {
          reportId: ids.report,
          reportVersionId: issued.id,
          version: issued.version,
          metricSnapshotId: issued.metricSnapshot.id,
          issuedAt: issued.issuedAt,
          payloadSha256: issued.payloadSha256,
          metricSnapshotSha256: issued.metricSnapshotSha256,
        },
        evidencePath: {
          trackedLinkId: link.data!.id,
          clickEventId: path.clickEventId,
          creatorId: path.creatorId,
          contentAssetId: path.contentAssetId,
          touchTime: path.touchTime,
          walletProofState: path.walletProofState,
          conversionFactId: path.conversionFactId,
          attributionFactId: path.attributionFactId,
          attributionModel: path.attributionModel,
          attributionWindowSeconds: path.attributionWindowSeconds,
          confidence: path.confidence,
          primaryRoasEligible: path.primaryRoasEligible,
          canonicalChainEventId: path.canonicalChainEventId,
          rawChainEventId: z.uuid().parse(canonical.data!.raw_chain_event_id),
          transactionSignature: path.transactionSignature,
          transactionSlot: path.transactionSlot,
          eventTime: path.eventTime,
          eventName: path.eventName,
          environment: path.environment,
          finality: path.finality,
          valueKind: path.valueKind,
          rawAmount: path.rawAmount,
          decimals: path.decimals,
          conversionRuleVersionId: path.conversionRuleVersionId,
          conversionRuleVersion: path.conversionRuleVersion,
          conversionEvaluatorVersion: path.conversionEvaluatorVersion,
        },
        assertions: {
          retainedEligibleTouchMatchesReport: true,
          retainedWalletProofStateIsSignedNonceAndConsent: true,
          retainedConfiguredActionMatchesReport: true,
          singleTouchFallsInsideConfiguredSevenDayWindow: true,
          reportClassifiesPathStrongAndPrimaryRoasEligible: true,
          qualifiedAndActivatedMetricsShareExactEvidence: true,
          anonymousReportReadDenied: true,
          protectedWalletAndRawEvidenceReadDenied: true,
        },
        notProvedByThisConsumer: [
          "historical producer route execution",
          "last-touch selection between competing eligible touches",
          "tampered, revoked or expired link handling",
          "proof replay, proof expiry or unlink handling",
          "duplicate provider delivery or canonical deduplication",
          "nonqualifying action rejection",
          "genuine public or devnet source activity",
        ],
        limitations: [
          "This is a synthetic local rehearsal, not a public Solana action.",
          "The transaction signature is synthetic and the finalized RPC response was mocked.",
          "No hosted provider configuration, customer activation, mainnet payment or wallet secret was used.",
          "This consumer proves authenticated read-through and exact retained linkage; focused suites separately cover adversarial and selection behavior.",
        ],
      } as const;
      const serialized = JSON.stringify(manifest);
      for (const forbidden of [
        '"walletAddress":',
        '"protectedWalletMappingId":',
        '"signatureHash":',
        '"signedMessageHash":',
        '"nonce":',
        '"privateKey":',
        '"seedPhrase":',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
      writeFileSync(exportPath, JSON.stringify(manifest, null, 2) + "\n", {
        mode: 0o600,
      });
    } finally {
      const signedOut = await manager.auth.signOut();
      expect(signedOut.error).toBeNull();
    }
  }, 120_000);
});

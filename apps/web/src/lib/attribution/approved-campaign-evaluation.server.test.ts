import type { SupabaseClient } from "@supabase/supabase-js";
import * as attribution from "@landed/attribution";
import { describe, expect, it, vi } from "vitest";

import fixture from "../../../../../packages/db/src/fixtures/bsk09-rule-resolution.json";
import retained from "../../../../../packages/db/src/fixtures/bsk09-retained-candidate.json";
import { evaluateApprovedCampaignCandidate } from "./approved-campaign-evaluation.server";

const rule = fixture[0]!;
const mappingId = "50000000-0000-4000-8000-000000000001";
const walletAddress = "11111111111111111111111111111111";
function input() {
  return {
    workspaceId: rule.workspace_id,
    projectId: rule.project_id,
    campaignId: "70000000-0000-4000-8000-000000000001",
    wallet: {
      workspaceId: rule.workspace_id,
      projectId: rule.project_id,
      protectedWalletMappingId: mappingId,
      anonymousSessionId: "60000000-0000-4000-8000-000000000001",
      walletAddress,
      activeFrom: "2026-09-01T00:00:00Z",
      monitoringEndsAt: "2026-09-08T00:00:00Z",
      unlinkedAt: null as string | null,
    },
    evidence: {
      kind: "solana_transfer" as const,
      canonicalChainEventId: "80000000-0000-4000-8000-000000000001",
      finality: "finalized" as "finalized" | "confirmed" | "processed",
      event: {
        chain: "solana" as const,
        eventTime: "2026-09-02T00:00:00Z",
        id: "90000000-0000-4000-8000-000000000001:native_transfer:0",
        ingestedAt: "2026-09-02T00:00:01Z",
        projectId: rule.project_id,
        workspaceId: rule.workspace_id,
        rawEvidenceId: "90000000-0000-4000-8000-000000000001",
        schemaVersion: 1 as const,
        slot: "123456",
        source: "helius_webhook" as const,
        sourceEventId: "90000000-0000-4000-8000-000000000001",
        sourceTransferIndex: 0,
        sourceTransferKind: "native_transfer" as const,
        transactionSignature: "1".repeat(64),
        eventName: "solana.native_transfer" as const,
        fromAddress: walletAddress,
        toAddress: "Vote111111111111111111111111111111111111111",
        nativeAmountLamports: "9007199254740993123",
      },
    },
    priorConversion: null as {
      conversionFactId: string;
      ruleVersionId: string;
      protectedWalletMappingId: string;
      conversionTime: string;
    } | null,
  };
}
function client(data: unknown = fixture, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { rpc, db: { rpc } as unknown as SupabaseClient };
}

describe("BSK-09 read-only approved campaign candidate", () => {
  it("accepts the actual isolated retained-loader output without value loss", async () => {
    expect(retained.status).toBe("ready");
    const c = client([retained.ruleVersion]);
    const result = await evaluateApprovedCampaignCandidate(c.db, {
      workspaceId: retained.workspaceId,
      projectId: retained.projectId,
      campaignId: retained.campaignId,
      wallet: attribution.conversionWalletContextSchema.parse(retained.wallet),
      evidence: attribution.conversionEvidenceSchema.parse(retained.evidence),
      priorConversion: null,
    });
    expect(result).toMatchObject({
      kind: "candidate",
      status: "evaluated",
      campaignId: retained.campaignId,
      evaluation: {
        outcome: "match",
        value: { rawAmount: "9007199254740993123" },
        revenue: { kind: "none" },
      },
    });
  });
  it("maps actual stored rule provenance without invented metadata or fractional loss", async () => {
    const observed = {
      ...rule,
      name: "Approved acquisition definition",
      description: "Actual retained description from the resolver row.",
      change_reason: "Actual retained measurement decision",
      created_at: "2026-09-01T01:00:00.123456+01:00",
    };
    const evaluator = vi.spyOn(attribution, "evaluateConversion");
    try {
      await evaluateApprovedCampaignCandidate(client([observed]).db, input());
      expect(evaluator).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          ruleVersion: expect.objectContaining({
            id: observed.id,
            ruleId: observed.rule_id,
            name: observed.name,
            description: observed.description,
            changeReason: observed.change_reason,
            createdBy: observed.created_by,
            createdAt: "2026-09-01T00:00:00.123456Z",
          }),
        }),
      );
    } finally {
      evaluator.mockRestore();
    }
  });
  it("evaluates wallet binding against its pinned wallet rule and uses binding time", async () => {
    const request = input();
    const c = client([
      {
        ...rule,
        template_code: "wallet_connected",
        minimum_finality: "not_applicable",
        value_mapping: "none",
        match_conditions: {
          kind: "wallet_connected",
          requiresWalletBinding: true,
        },
      },
    ]);
    const result = await evaluateApprovedCampaignCandidate(c.db, {
      ...request,
      evidence: { kind: "wallet_binding", protectedWalletMappingId: mappingId },
    });
    expect(result).toMatchObject({
      kind: "candidate",
      status: "evaluated",
      evaluation: {
        outcome: "match",
        conversionTime: "2026-09-01T00:00:00.000Z",
        value: { kind: "none" },
        revenue: { kind: "none" },
      },
    });
    expect(c.rpc).toHaveBeenCalledExactlyOnceWith(
      "resolve_campaign_conversion_rule_version",
      {
        target_project_id: rule.project_id,
        target_campaign_id: request.campaignId,
        target_effective_at: request.wallet.activeFrom,
      },
    );
  });
  it("rejects mismatched wallet-binding evidence without a rule read", async () => {
    const request = input();
    const c = client();
    await expect(
      evaluateApprovedCampaignCandidate(c.db, {
        ...request,
        evidence: {
          kind: "wallet_binding",
          protectedWalletMappingId: request.campaignId,
        },
      }),
    ).rejects.toThrow("context is invalid");
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it("does not return a match for supplied future conversion history", async () => {
    const request = input();
    request.priorConversion = {
      conversionFactId: request.campaignId,
      ruleVersionId: rule.id,
      protectedWalletMappingId: mappingId,
      conversionTime: "2026-09-03T00:00:00Z",
    };
    await expect(
      evaluateApprovedCampaignCandidate(client().db, request),
    ).rejects.toThrow("context is invalid");
  });
  it("returns precision unsupported before a read without leaking supplied wallet data", async () => {
    const request = input();
    request.evidence.event.eventTime = "2026-09-02T00:00:00.1230001Z";
    const c = client();
    const result = await evaluateApprovedCampaignCandidate(c.db, request);
    expect(result).toEqual({
      kind: "candidate",
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      campaignId: request.campaignId,
      status: "precision_unsupported",
    });
    expect(c.rpc).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(walletAddress);
  });
  it("uses only the pinned lookup, preserves exact value and labels candidate scope", async () => {
    const c = client();
    const result = await evaluateApprovedCampaignCandidate(c.db, input());
    expect(result).toMatchObject({
      kind: "candidate",
      campaignId: input().campaignId,
      status: "evaluated",
      ruleVersionId: rule.id,
      evaluation: {
        outcome: "match",
        evaluatorVersion: 1,
        value: { rawAmount: "9007199254740993123" },
        revenue: { kind: "none" },
      },
    });
    expect(c.rpc).toHaveBeenCalledExactlyOnceWith(
      "resolve_campaign_conversion_rule_version",
      {
        target_project_id: rule.project_id,
        target_campaign_id: input().campaignId,
        target_effective_at: input().evidence.event.eventTime,
      },
    );
    expect(JSON.stringify(result)).not.toContain(walletAddress);
  });
  it("does not turn outside-window into zero or a match", async () => {
    expect(
      await evaluateApprovedCampaignCandidate(client([]).db, input()),
    ).toMatchObject({ kind: "candidate", status: "outside_approved_window" });
  });
  it.each(["wallet", "event"])(
    "rejects foreign %s scope before any read",
    async (field) => {
      const request = input();
      if (field === "wallet") request.wallet.projectId = request.campaignId;
      else request.evidence.event.workspaceId = request.campaignId;
      const c = client();
      await expect(
        evaluateApprovedCampaignCandidate(c.db, request),
      ).rejects.toThrow("context is invalid");
      expect(c.rpc).not.toHaveBeenCalled();
    },
  );
  it.each(["event", "active", "end", "unlink", "prior"])(
    "rejects unsupported %s precision",
    async (field) => {
      const request = input();
      const time = "2026-09-01T00:00:00.000001Z";
      if (field === "event") request.evidence.event.eventTime = time;
      if (field === "active") request.wallet.activeFrom = time;
      if (field === "end") request.wallet.monitoringEndsAt = time;
      if (field === "unlink") request.wallet.unlinkedAt = time;
      if (field === "prior")
        request.priorConversion = {
          conversionFactId: request.campaignId,
          ruleVersionId: rule.id,
          protectedWalletMappingId: mappingId,
          conversionTime: time,
        };
      // Keep valid millisecond ordering for the existing wallet schema.
      if (field === "end")
        request.wallet.monitoringEndsAt = "2026-09-08T00:00:00.000001Z";
      expect(
        await evaluateApprovedCampaignCandidate(client().db, request),
      ).toMatchObject({ status: "precision_unsupported" });
    },
  );
  it.each(["effective_from", "effective_until"])(
    "rejects unsupported rule %s precision",
    async (field) => {
      const row = {
        ...rule,
        [field]:
          field === "effective_from"
            ? "2026-09-01T00:00:00.000001Z"
            : "2026-09-03T00:00:00.000001Z",
      };
      expect(
        await evaluateApprovedCampaignCandidate(client([row]).db, input()),
      ).toMatchObject({ status: "precision_unsupported" });
    },
  );
  it("accepts exact millisecond padding and timezone offsets", async () => {
    const request = input();
    request.evidence.event.eventTime = "2026-09-02T01:00:00.123000+01:00";
    const c = client([
      { ...rule, created_at: "2026-09-01T01:00:00.123456+01:00" },
    ]);
    expect(
      await evaluateApprovedCampaignCandidate(c.db, request),
    ).toMatchObject({
      status: "evaluated",
      evaluation: { conversionTime: "2026-09-02T00:00:00.123Z" },
    });
  });
  it.each([
    ["confirmed", "minimum_finality_not_met"],
    ["processed", "minimum_finality_not_met"],
    ["expired", "wallet_binding_expired"],
    ["unlinked", "wallet_binding_unlinked"],
    ["source", "wallet_not_transaction_source"],
    ["prior", "prior_conversion_exists"],
  ])("retains V1 %s checks", async (change, reason) => {
    const request = input();
    if (change === "confirmed" || change === "processed")
      request.evidence.finality = change;
    if (change === "expired")
      request.wallet.monitoringEndsAt = request.evidence.event.eventTime;
    if (change === "unlinked")
      request.wallet.unlinkedAt = request.evidence.event.eventTime;
    if (change === "source")
      request.evidence.event.fromAddress = request.evidence.event.toAddress;
    if (change === "prior")
      request.priorConversion = {
        conversionFactId: request.campaignId,
        ruleVersionId: rule.id,
        protectedWalletMappingId: mappingId,
        conversionTime: "2026-09-01T12:00:00Z",
      };
    expect(
      await evaluateApprovedCampaignCandidate(client().db, request),
    ).toMatchObject({
      status: "evaluated",
      evaluation: { outcome: "non_match", reason },
    });
  });
  it("rejects a prior conversion from another rule", async () => {
    const request = input();
    request.priorConversion = {
      conversionFactId: request.campaignId,
      ruleVersionId: request.campaignId,
      protectedWalletMappingId: mappingId,
      conversionTime: "2026-09-01T12:00:00Z",
    };
    await expect(
      evaluateApprovedCampaignCandidate(client().db, request),
    ).rejects.toThrow("context is invalid");
  });
  it("fails closed on unavailable or malformed rule without fallback", async () => {
    for (const c of [
      client([], { code: "42501" }),
      client([{ ...rule, name: undefined }]),
    ]) {
      await expect(
        evaluateApprovedCampaignCandidate(c.db, input()),
      ).rejects.toThrow("could not be prepared");
      expect(c.rpc).toHaveBeenCalledTimes(1);
    }
  });
});

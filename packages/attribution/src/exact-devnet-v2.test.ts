import { describe, expect, it } from "vitest";

import {
  attributionTouchCandidateSchema,
  evaluateLastTouchAttribution,
  isAttributedTouch,
  type AttributionTouchCandidate,
} from "./last-touch-v2";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";
const ruleId = "30000000-0000-4000-8000-000000000001";
const ruleVersionId = "40000000-0000-4000-8000-000000000001";
const conversionFactId = "50000000-0000-4000-8000-000000000001";
const walletAddress = "11111111111111111111111111111111";
const otherWallet = "Vote111111111111111111111111111111111111111";

function ruleVersion() {
  return {
    id: ruleVersionId,
    ruleId,
    workspaceId,
    projectId,
    version: 1,
    configuredEnvironment: "devnet" as const,
    destinationAddress: otherWallet,
    nativeAmountLamports: "1",
    templateCode: "first_qualifying_transaction" as const,
    name: "First qualifying transaction",
    description: "A finalized outgoing transfer from the controlled wallet.",
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    effectiveUntil: null,
    chain: "solana" as const,
    requiresWalletBinding: true as const,
    minimumFinality: "finalized" as const,
    valueMapping: "transfer_amount" as const,
    revenueMapping: "none" as const,
    attributionWindowSeconds: 604_800 as const,
    attributionModel: "last_eligible_creator_touch" as const,
    programId: null,
    eventDiscriminator: null,
    evidenceCapability: "ready" as const,
    changeReason: "Create attribution fixture rule",
    createdBy: "60000000-0000-4000-8000-000000000001",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

function conversion() {
  return {
    id: conversionFactId,
    workspaceId,
    projectId,
    walletAddress,
    evaluatorVersion: 2 as const,
    ruleVersionId,
    protectedWalletMappingId: "70000000-0000-4000-8000-000000000001",
    evidenceId: "80000000-0000-4000-8000-000000000001",
    evidenceTime: "2026-08-12T12:00:00.000Z",
    outcome: "match" as const,
    reason: "matched" as const,
    conversionTime: "2026-08-12T12:00:00.000Z",
    value: {
      kind: "native_lamports" as const,
      rawAmount: "9007199254740993123",
      decimals: 9 as const,
    },
    revenue: { kind: "none" as const },
  };
}

function touch(
  overrides: Partial<AttributionTouchCandidate> = {},
): AttributionTouchCandidate {
  return {
    id: "90000000-0000-4000-8000-000000000001",
    workspaceId,
    projectId,
    campaignId: "a0000000-0000-4000-8000-000000000001",
    creatorId: "b0000000-0000-4000-8000-000000000001",
    contentAssetId: "c0000000-0000-4000-8000-000000000001",
    trackedLinkId: "d0000000-0000-4000-8000-000000000001",
    clickEventId: "e0000000-0000-4000-8000-000000000001",
    clickQualityAssessmentId: "f0000000-0000-4000-8000-000000000001",
    anonymousSessionId: "11000000-0000-4000-8000-000000000001",
    walletProofId: "12000000-0000-4000-8000-000000000001",
    measurementConsentId: "13000000-0000-4000-8000-000000000001",
    protectedWalletMappingId: "14000000-0000-4000-8000-000000000001",
    walletAddress,
    touchTime: "2026-08-12T10:00:00.000Z",
    sessionExpiresAt: "2026-08-19T10:00:00.000Z",
    mappingActiveFrom: "2026-08-12T10:05:00.000Z",
    mappingMonitoringEndsAt: "2026-08-19T10:00:00.000Z",
    mappingUnlinkedAt: null,
    linkEligibility: "eligible",
    clickQualityOutcome: "qualified",
    clickQualityReason: "passed_declared_checks",
    sessionClickKind: "originating",
    ...overrides,
  };
}

import { evaluateConversion } from "./conversion-v2";
import { exactInstant, exactMicros } from "./exact-instants";

describe("ATT-01 explicit Devnet evaluator V2", () => {
  it("preserves microseconds across offsets and rejects unsupported precision", () => {
    expect(exactInstant("2026-10-08T01:00:00.123456+01:00")).toBe(
      "2026-10-08T00:00:00.123456Z",
    );
    expect(
      exactMicros("2026-10-08T00:00:00.123457Z") -
        exactMicros("2026-10-08T00:00:00.123456Z"),
    ).toBe(1n);
    expect(() => exactInstant("2026-10-08T00:00:00.1234567Z")).toThrow();
    expect(exactInstant("1969-12-31T23:59:59.999999Z")).toBe(
      "1969-12-31T23:59:59.999999Z",
    );
  });
  it("ranks touches by microsecond before UUID tie-breaks", () => {
    const older = touch({
      id: "ffffffff-0000-4000-8000-000000000001",
      touchTime: "2026-08-12T10:00:00.123455Z",
      sessionExpiresAt: "2026-08-19T10:00:00.123455Z",
      mappingMonitoringEndsAt: "2026-08-19T10:00:00.123455Z",
    });
    const later = touch({
      id: "00000000-0000-4000-8000-000000000001",
      clickEventId: "00000000-0000-4000-8000-000000000002",
      touchTime: "2026-08-12T10:00:00.123456Z",
      sessionExpiresAt: "2026-08-19T10:00:00.123456Z",
      mappingMonitoringEndsAt: "2026-08-19T10:00:00.123456Z",
    });
    const result = evaluateLastTouchAttribution({
      ruleVersion: ruleVersion(),
      conversion: conversion(),
      touches: [older, later],
    });
    expect(isAttributedTouch(result) && result.touchId).toBe(later.id);
    expect(result.attributionEvaluatorVersion).toBe(2);
  });
  it.each([
    ["2026-08-12T12:00:00.000001Z", null, false],
    ["2026-08-12T12:00:00.000000Z", null, true],
    ["2026-08-12T11:59:59.999999Z", "2026-08-12T12:00:00.000000Z", false],
    ["2026-08-12T11:59:59.999999Z", "2026-08-12T12:00:00.000001Z", true],
  ] as const)(
    "uses exact active/unlink boundaries %s %s",
    (active, unlink, eligible) => {
      const result = evaluateLastTouchAttribution({
        ruleVersion: ruleVersion(),
        conversion: conversion(),
        touches: [
          touch({ mappingActiveFrom: active, mappingUnlinkedAt: unlink }),
        ],
      });
      expect(isAttributedTouch(result)).toBe(eligible);
    },
  );
  it("rejects a one-microsecond session-expiry mismatch", () => {
    expect(() =>
      attributionTouchCandidateSchema.parse(
        touch({
          sessionExpiresAt: "2026-08-19T10:00:00.000001Z",
        }),
      ),
    ).toThrow();
  });
  it("rejects non-Devnet V2 rules", () => {
    expect(() =>
      evaluateLastTouchAttribution({
        ruleVersion: {
          ...ruleVersion(),
          configuredEnvironment: "mainnet" as "devnet",
        },
        conversion: conversion(),
        touches: [touch()],
      }),
    ).toThrow();
  });
  const input = () => ({
    ruleVersion: ruleVersion(),
    wallet: {
      protectedWalletMappingId: conversion().protectedWalletMappingId,
      anonymousSessionId: touch().anonymousSessionId,
      workspaceId,
      projectId,
      walletAddress,
      activeFrom: "2026-08-12T12:00:00.123456Z",
      monitoringEndsAt: "2026-08-19T10:00:00.000000Z",
      unlinkedAt: null as string | null,
    },
    evidence: {
      kind: "solana_transfer" as const,
      canonicalChainEventId: "80000000-0000-4000-8000-000000000001",
      finality: "finalized" as const,
      configuredEnvironment: "devnet" as const,
      event: {
        chain: "solana" as const,
        eventTime: "2026-08-12T12:00:00.123456Z",
        id: "90000000-0000-4000-8000-000000000001:native_transfer:0",
        ingestedAt: "2026-08-12T12:00:01.000Z",
        projectId,
        workspaceId,
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
        toAddress: otherWallet,
        nativeAmountLamports: "1",
      },
    },
    priorConversion: null,
  });
  it.each([
    ["2026-08-12T12:00:00.123455Z", "non_match"],
    ["2026-08-12T12:00:00.123456Z", "match"],
    ["2026-08-12T12:00:00.123457Z", "match"],
  ])("never admits a transfer before consent: %s", (time, outcome) => {
    const v = input();
    v.evidence.event.eventTime = time;
    expect(evaluateConversion(v).outcome).toBe(outcome);
    expect(evaluateConversion(v).evaluatorVersion).toBe(2);
  });
  it.each(["expiry", "unlink", "rule_end"] as const)(
    "excludes equality at %s",
    (boundary) => {
      const v = input();
      const time = v.evidence.event.eventTime;
      if (boundary === "expiry") v.wallet.monitoringEndsAt = time;
      else if (boundary === "unlink") v.wallet.unlinkedAt = time;
      else Object.assign(v.ruleVersion, { effectiveUntil: time });
      v.wallet.activeFrom = "2026-08-12T12:00:00.123455Z";
      expect(evaluateConversion(v).outcome).toBe("non_match");
    },
  );
  it.each(["environment", "receiver", "amount"] as const)(
    "still rejects wrong %s",
    (field) => {
      const v = input();
      if (field === "environment")
        Object.assign(v.evidence, { configuredEnvironment: "mainnet" });
      if (field === "receiver") v.evidence.event.toAddress = walletAddress;
      if (field === "amount") v.evidence.event.nativeAmountLamports = "2";
      expect(evaluateConversion(v).outcome).toBe("non_match");
    },
  );
});

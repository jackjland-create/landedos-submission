import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/timed-campaign-execution-report.json";
import {
  compareTimedReportSourceFingerprints,
  loadTimedCampaignExecutionReportReview,
} from "./campaign-execution.server";

const base = fixture.afterReceipt;
const scope = {
  workspaceId: base.execution.preview.review.workspaceId,
  projectId: base.execution.preview.review.projectId,
  campaignId: base.execution.preview.review.campaignId,
};
async function read(data: unknown = base) {
  const client = { rpc: vi.fn().mockResolvedValue({ data, error: null }) };
  const result = await loadTimedCampaignExecutionReportReview(
    client,
    scope,
    base.execution.approvalId,
  );
  expect(client.rpc).toHaveBeenCalledTimes(1);
  return result;
}
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, child]) => [key, reverseKeys(child)]),
    );
  return value;
}

describe("private timed report source drift", () => {
  it("exposes only a versioned digest and never issuance authority", async () => {
    const result = await read();
    expect(result.sourceFingerprint).toEqual({
      protocol: "landed:timed-report-retained-sources:v1",
      algorithm: "sha256",
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      meaning: "retained_observations_only",
    });
    expect(
      compareTimedReportSourceFingerprints(
        result.sourceFingerprint,
        result.sourceFingerprint,
      ),
    ).toEqual({
      observation: "same_retained_sources",
      reportIssuance: "blocked",
    });
    expect(result.reportIssuance).toBe("blocked");
    expect(result.completeness).toBe("not_established");
    expect(JSON.stringify(result.sourceFingerprint)).not.toContain(
      base.execution.preview.review.candidates[0]!.protectedWalletMappingId,
    );
  });

  it("is invariant to nested object order and only the snapshot read clock", async () => {
    const raw = structuredClone(base);
    raw.execution.readAt = "2026-10-20T12:00:00.000001Z";
    const first = await read();
    const second = await read(reverseKeys(raw));
    expect(second.sourceFingerprint).toEqual(first.sourceFingerprint);
    expect(second.execution.readAt).toBe(raw.execution.readAt);
  });

  it.each([
    [
      "conversion microsecond",
      (raw: typeof base) => {
        raw.reportReview.reportSources.results[0]!.conversionTime =
          "2026-09-08T12:00:00.000001+00:00";
      },
    ],
    [
      "same-count raw value",
      (raw: typeof base) => {
        raw.reportReview.reportSources.results[0]!.value.rawAmount =
          "9007199254740993124";
      },
    ],
    [
      "same-count audit tuple",
      (raw: typeof base) => {
        raw.reportReview.reportSources.results[0]!.auditId =
          "99999999-0000-4000-8000-000000000011";
      },
    ],
    [
      "retained cost source",
      (raw: typeof base) => {
        raw.reportReview.reportSources.commercialPlanSnapshot.packages[0]!.compensationLines[0]!.amountMinor =
          "127501";
      },
    ],
    [
      "approval reason",
      (raw: typeof base) => {
        raw.execution.reason = "Synthetic changed review reason";
      },
    ],
    [
      "approval microsecond",
      (raw: typeof base) => {
        raw.execution.approvedAt = raw.execution.approvedAt.replace(
          /\dZ$/,
          "9Z",
        );
      },
    ],
    [
      "representation-only time",
      (raw: typeof base) => {
        raw.reportReview.reportSources.results[0]!.conversionTime =
          "2026-09-08T13:00:00+01:00";
      },
    ],
  ] as const)(
    "detects %s without promoting the source",
    async (_name, change) => {
      // Synthetic schema-valid drift: not a claim that immutable SQL rows can be edited.
      const raw = structuredClone(base);
      change(raw);
      const before = await read();
      const after = await read(raw);
      expect(after.reportReview.observedEvidence.resultCount).toBe(
        before.reportReview.observedEvidence.resultCount,
      );
      expect(
        compareTimedReportSourceFingerprints(
          before.sourceFingerprint,
          after.sourceFingerprint,
        ),
      ).toEqual({
        observation: "changed_retained_sources",
        reportIssuance: "blocked",
      });
    },
  );

  it("binds missing versus recorded execution receipt", async () => {
    const before = await read(fixture.beforeReceipt);
    const after = await read();
    expect(before.sourceFingerprint.digest).not.toBe(
      after.sourceFingerprint.digest,
    );
  });

  it("binds latest history attempts while retaining missing coverage", async () => {
    const raw = structuredClone(base);
    const mapping = raw.reportReview.historyReadiness.mappings[0]!;
    const changed = {
      ...raw,
      reportReview: {
        ...raw.reportReview,
        historyReadiness: {
          ...raw.reportReview.historyReadiness,
          mappings: raw.reportReview.historyReadiness.mappings.map(
            (entry, index) =>
              index !== 0
                ? entry
                : {
                    ...entry,
                    latestJob: {
                      id: "99999999-0000-4000-8000-000000000012",
                      environment: "demo",
                      status: "running",
                      ...mapping.requiredHistory,
                      completedAt: null,
                      normalizationIssueCount: 0,
                    },
                  },
          ),
        },
      },
    };
    const first = await read();
    const second = await read(changed);
    expect(second.sourceFingerprint.digest).not.toBe(
      first.sourceFingerprint.digest,
    );
    expect(second.completeness).toBe("not_established");
  });

  it("binds campaign-wide evidence outside the approved execution subset", async () => {
    const raw = structuredClone(base);
    const extra = structuredClone(raw.reportReview.reportSources.results[0]!);
    extra.calculationRequestId = "99999999-0000-4000-8000-000000000001";
    extra.conversionFactId = "99999999-0000-4000-8000-000000000002";
    extra.attributionFactId = "99999999-0000-4000-8000-000000000003";
    extra.auditId = "99999999-0000-4000-8000-000000000004";
    extra.canonicalChainEventId = "99999999-0000-4000-8000-000000000005";
    raw.reportReview.reportSources.results.push(extra);
    const added = await read(raw);
    extra.value.rawAmount = "42";
    const altered = await read(raw);
    expect(added.sourceFingerprint.digest).not.toBe(
      altered.sourceFingerprint.digest,
    );
    const original = await read();
    expect(added.sourceFingerprint.digest).not.toBe(
      original.sourceFingerprint.digest,
    );
    expect(added.execution.receipt!.batch.processedCount).toBe(1);
    raw.reportReview.reportSources.results.reverse();
    expect((await read(raw)).sourceFingerprint.digest).not.toBe(
      altered.sourceFingerprint.digest,
    );
  });

  it("still rejects scope drift before returning a fingerprint", async () => {
    const raw = structuredClone(base);
    raw.execution.preview.review.projectId =
      "99999999-0000-4000-8000-000000000001";
    await expect(read(raw)).rejects.toMatchObject({ outcome: "unconfirmed" });
  });

  it("rejects malformed or unsupported comparison protocols on either side", async () => {
    const valid = (await read()).sourceFingerprint;
    for (const invalid of [
      null,
      {},
      { ...valid, protocol: "v2" },
      { ...valid, algorithm: "sha1" },
      { ...valid, digest: valid.digest.toUpperCase() },
      { ...valid, ready: true },
      { ...valid, meaning: "authorized" },
    ]) {
      expect(() =>
        compareTimedReportSourceFingerprints(invalid, valid),
      ).toThrow();
      expect(() =>
        compareTimedReportSourceFingerprints(valid, invalid),
      ).toThrow();
    }
  });
});

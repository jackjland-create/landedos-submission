import { describe, it, expect } from "vitest";
import {
  basketRecordSchema,
  campaignRecordSchema,
  creatorDirectoryRecordSchema,
} from "@landed/contracts";
import {
  buildSubmissionCampaign,
  submissionDaily,
  submissionRoster,
} from "./submission-campaign";
import { clarityMetrics } from "./reports/clarity";
describe("DEM-01 coherent read-only submission snapshot", () => {
  it("reconciles the actual calculators, creators and fourteen daily cohorts", () => {
    const s = buildSubmissionCampaign();
    expect(campaignRecordSchema.parse(s.campaign).roster).toHaveLength(3);
    expect(basketRecordSchema.parse(s.basket).packages).toHaveLength(3);
    s.creators.forEach((c) => creatorDirectoryRecordSchema.parse(c));
    expect(clarityMetrics(s.selectedVersion)).toMatchObject({
      qualified: 400,
      clicks: 2600,
      spend: "£7,000.00",
      cpqw: "£17.50",
      activated: null,
      revenue: "Not available",
    });
    expect(submissionDaily).toHaveLength(14);
    expect(submissionDaily.reduce((a, b) => a + b, 0)).toBe(400);
    expect(submissionRoster.reduce((s, c) => s + c.consent, 0)).toBe(800);
    expect(s.rankingEvidencePaths).toHaveLength(400);
    expect(
      new Set(s.rankingEvidencePaths.map((p) => p.attributionFactId)).size,
    ).toBe(400);
    for (const row of s.selectedVersion.measurementContext!.observations)
      expect(row.sourceEvidenceIds.length).toBe(Number(row.valueDecimal));
    expect(s.economics[1].allocatedSpendMinor).toBe("700000");
    expect(s.economics[1].unallocatedSpendMinor).toBe("0");
    expect(
      s.campaign.contentAssets.reduce(
        (sum, asset) =>
          sum +
          asset.trackedLinks.reduce(
            (n, link) => n + link.clickQuality.qualifiedClicks,
            0,
          ),
        0,
      ),
    ).toBe(2600);
    expect(
      s.campaign.contentAssets.every((asset) =>
        asset.trackedLinks.every((link) => !link.destinationPolicyActive),
      ),
    ).toBe(true);
    expect(s.report.versions).toHaveLength(1);
    expect(JSON.stringify(s)).not.toMatch(/Helios|https:\/\/x.com/);
    expect(s.rankingEvidencePaths.every((p) => p.environment === "demo")).toBe(
      true,
    );
  });
});

import type { CampaignRecord } from "@landed/contracts";
import snapshot from "../../../../packages/contracts/src/fixtures/bsk09-timed-review.json";
import type { CampaignWorkspaceContext } from "./campaign-workspace-context.server";

const id = "1672f518-a084-44d3-a86f-88e2dc831e85";
const creatorId = "81000000-0000-4000-8000-000000000001";
const actor = "30990000-0000-4000-8000-000000000001";
const date = "2026-09-22T12:00:00.000Z";
/** Synthetic layout fixture, never an approval or connected-database claim. */
export const workspaceFixture: CampaignRecord = {
  id,
  workspaceId: snapshot.review_snapshot.workspaceId,
  projectId: snapshot.review_snapshot.projectId,
  basketId: snapshot.review_snapshot.basket.id,
  commercialPlanVersionId: "a2000000-0000-4000-8000-000000000001",
  commercialPlanVersion: 1,
  name: "Research-led creator campaign",
  objective:
    "Reach relevant communities with a clear, measurable creator brief.",
  outcomeProfile: {
    metric: "qualified_wallets",
    baselineUnits: "0",
    targetUnits: "100",
    currencyCode: null,
  },
  status: "draft",
  createdBy: actor,
  createdAt: date,
  updatedAt: date,
  roster: [
    {
      id: creatorId,
      creatorId,
      creatorName: "Synthetic Research Partner",
      creatorHandle: "@synthetic_1",
      sourcePackageId: snapshot.review_snapshot.packages[0].id,
      rosterPosition: 1,
      packageLabel: "Research package",
      deliverableSummary: "One research thread and one community discussion",
      termsHash: "a".repeat(64),
      createdAt: date,
      commercialTerms: {
        id: snapshot.review_snapshot.packages[0].id,
        creatorId,
        packageLabel: "Research package",
        deliverableSummary: "One research thread and one community discussion",
        sourceRateQuoteId: null,
        compensationLines: [
          {
            id: "a4000000-0000-4000-8000-000000000001",
            assetType: "cash",
            model: "fixed",
            amountMinor: "127500",
            currencyCode: "GBP",
          },
        ],
        commercialDetail: {
          schemaVersion: 1,
          revision: 2,
          creatorDisplayName: "Synthetic Research Partner",
          channels: [
            {
              id: "b1000000-0000-4000-8000-000000000001",
              channelType: "x",
              handle: "@synthetic_1",
            },
          ],
          deliveryDeadline: "2026-10-01T12:30:00.000000Z",
          usageRights:
            "Organic repost on brand X account for 30 days. No paid use.",
          exclusivity:
            "No direct competitor promotion for 7 days after publication.",
        },
      },
    },
  ],
  briefVersions: [
    {
      id: "a8000000-0000-4000-8000-000000000001",
      version: 1,
      requestId: "a9000000-0000-4000-8000-000000000001",
      status: "draft",
      objective: "Reach relevant communities",
      audience: null,
      keyMessage: null,
      creatorDirection: null,
      complianceNotes: null,
      reason: "Synthetic initial brief",
      actorUserId: actor,
      createdAt: date,
    },
  ],
  contentAssets: [
    {
      id: "a5000000-0000-4000-8000-000000000001",
      campaignCreatorId: creatorId,
      creatorId,
      assetIndex: 1,
      label: "One research thread and one community discussion",
      status: "planned",
      submissionUrl: null,
      publishedUrl: null,
      publicationEvidence: [],
      trackedLinks: [],
      activity: [],
      createdAt: date,
      updatedAt: date,
    },
  ],
  activity: [],
};
export const workspaceContextFixture: CampaignWorkspaceContext = {
  planAvailable: true,
  trackingRestricted: true,
  flight: snapshot.review_snapshot.strategyBinding.timing.flight,
  measurement: snapshot.review_snapshot.strategyBinding.measurementWindow,
  report: null,
  reportUnavailable: false,
};

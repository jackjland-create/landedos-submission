import type {
  AttributionConfidence,
  CampaignStatus,
  Creator,
  Metric,
} from "@landed/contracts";

export const project = {
  id: "helios",
  databaseId: "20000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000001",
  name: "Demo project",
  category: "Solana consumer",
  environment: "Seeded demo",
  freshness: "Updated 4 min ago",
};

export const campaign: {
  id: string;
  name: string;
  status: CampaignStatus;
  outcome: string;
  dates: string;
  confidence: AttributionConfidence;
} = {
  id: "summer-activation",
  name: "Summer activation",
  status: "live",
  outcome: "First funded account",
  dates: "08 Jul — 04 Aug",
  confidence: "strong",
};

export const overviewMetrics: Metric[] = [
  {
    label: "Campaign spend",
    value: "£18,600",
    detail: "Fully loaded",
    tone: "default",
  },
  {
    label: "Qualified wallets",
    value: "47",
    detail: "39 strong / 8 verified",
    tone: "verified",
  },
  {
    label: "Cost per action",
    value: "£396",
    detail: "Target £440",
    tone: "action",
  },
  {
    label: "Verified revenue",
    value: "£31,240",
    detail: "1.68× revenue ROAS",
    tone: "verified",
  },
];

export const creators: Creator[] = [
  {
    id: "c-01",
    name: "Maya / Chain Mode",
    handle: "@chainmode",
    channel: "X + Video",
    topicFit: 94,
    packageRateMinor: 460000n,
    historicCpqwMinor: 31800n,
    qualifiedWallets: 16,
    decision: "renew",
  },
  {
    id: "c-02",
    name: "Solana Sensei",
    handle: "@solsensei",
    channel: "X",
    topicFit: 91,
    packageRateMinor: 320000n,
    historicCpqwMinor: 35600n,
    qualifiedWallets: 11,
    decision: "renew",
  },
  {
    id: "c-03",
    name: "DeFi After Dark",
    handle: "@defiafterdark",
    channel: "Podcast + X",
    topicFit: 82,
    packageRateMinor: 520000n,
    historicCpqwMinor: 74200n,
    qualifiedWallets: 7,
    decision: "review",
  },
  {
    id: "c-04",
    name: "Onchain Alice",
    handle: "@onchainalice",
    channel: "Video",
    topicFit: 88,
    packageRateMinor: 390000n,
    historicCpqwMinor: null,
    qualifiedWallets: 8,
    decision: "review",
  },
  {
    id: "c-05",
    name: "Mint Condition",
    handle: "@mintcondition",
    channel: "X",
    topicFit: 66,
    packageRateMinor: 250000n,
    historicCpqwMinor: 108000n,
    qualifiedWallets: 5,
    decision: "stop",
  },
];

export const basketScenarios = [
  {
    id: "A",
    name: "Focused authority",
    spend: "£18,600",
    creators: 5,
    forecast: "42–58",
    confidence: "Medium",
    selected: true,
  },
  {
    id: "B",
    name: "Broad reach",
    spend: "£22,100",
    creators: 8,
    forecast: "45–64",
    confidence: "Low",
    selected: false,
  },
  {
    id: "C",
    name: "Proof first",
    spend: "£15,400",
    creators: 4,
    forecast: "39–51",
    confidence: "High",
    selected: false,
  },
];

export const campaignPhases = [
  { label: "Brief", state: "Complete", detail: "Approved 08 Jul" },
  { label: "Commercial plan", state: "Complete", detail: "£18,600 approved" },
  { label: "Creator acceptance", state: "Complete", detail: "5 / 5 accepted" },
  { label: "Deliverables", state: "Active", detail: "8 / 11 published" },
  { label: "Tracking", state: "Active", detail: "All links healthy" },
  { label: "Finalization", state: "Waiting", detail: "Begins 05 Aug" },
];

export const funnel = [
  { label: "Qualified clicks", value: 1684, display: "1,684" },
  { label: "Bound wallets", value: 226, display: "226" },
  { label: "Qualified actions", value: 47, display: "47" },
  { label: "D7 retained", value: 31, display: "31" },
];

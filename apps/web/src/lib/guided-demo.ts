export type GuidedDemoStep = {
  id: string;
  index: string;
  title: string;
  location: string;
  why: string;
  actionLabel: string;
  path: (projectId: string) => string;
  readiness: string;
  evidence: string;
  success: string;
  next: string;
  estimatedSeconds: number;
};

const reportId = guidedDemoManifest.reportId;

export const guidedDemoSteps: readonly GuidedDemoStep[] = [
  {
    id: "define-conversion",
    index: "01",
    title: "Define the outcome",
    location: "Conversion definitions",
    why: "Agree what customer action the campaign should create before spend is committed.",
    actionLabel: "REVIEW CONVERSION VERSIONS",
    path: (projectId) => `/projects/${projectId}/settings/conversions`,
    readiness:
      "Ready. The sanitized demo retains a versioned first-transaction rule.",
    evidence: "An immutable rule version and a replay-safe change record.",
    success:
      "The team can explain which action counts and when the rule became effective.",
    next: "Review the creators who can reach the audience.",
    estimatedSeconds: 30,
  },
  {
    id: "review-creators",
    index: "02",
    title: "Review the creator field",
    location: "KOL overview",
    why: "Compare audience fit, evidence readiness and commercial potential before shortlisting.",
    actionLabel: "OPEN KOL OVERVIEW",
    path: (projectId) => `/projects/${projectId}/kols`,
    readiness:
      "Ready. The sanitized creator directory is available for comparison.",
    evidence: "A visible shortlist rationale tied to retained creator records.",
    success: "The user can name why each creator belongs in the campaign.",
    next: "Package the selected creators into a commercial plan.",
    estimatedSeconds: 35,
  },
  {
    id: "build-basket",
    index: "03",
    title: "Build and price the basket",
    location: "Basket builder",
    why: "Turn creator choices into explicit deliverables, usage and compensation.",
    actionLabel: "OPEN BASKET BUILDER",
    path: (projectId) =>
      `/projects/${projectId}/baskets/${guidedDemoManifest.basketId}`,
    readiness: `Ready. ${guidedDemoManifest.basketName} retains the priced Golden launch package.`,
    evidence:
      "Frozen packages, deliverables, usage terms and exact money in GBP minor units.",
    success:
      "Every included package has a deliverable summary and a named commercial owner.",
    next: "Resolve any blockers and approve the commercial plan.",
    estimatedSeconds: 45,
  },
  {
    id: "approve-plan",
    index: "04",
    title: "Resolve blockers and approve",
    location: "Commercial approval",
    why: "Keep incomplete packages and uncertain money out of the campaign launch boundary.",
    actionLabel: "REVIEW APPROVAL READINESS",
    path: (projectId) =>
      `/projects/${projectId}/baskets/${guidedDemoManifest.basketId}#commercial-approval`,
    readiness: `Ready in the sanitized demo. Any blocker names ${guidedDemoManifest.blockerPackageName} and links to its resolution control.`,
    evidence:
      "A human-approved, immutable commercial plan version and audit record.",
    success:
      "The approval panel shows no unresolved blocker and exact total spend.",
    next: "Create the live campaign roster from the approved plan.",
    estimatedSeconds: 35,
  },
  {
    id: "activate-campaign",
    index: "05",
    title: "Activate the campaign",
    location: "Campaign workspace",
    why: "Move an approved plan into an operating campaign without changing its frozen terms.",
    actionLabel: "OPEN CAMPAIGN WORKSPACE",
    path: (projectId) => guidedDemoCampaignResolverPath(projectId, "workspace"),
    readiness:
      "Ready. The seeded campaign is active and linked to its approved plan.",
    evidence:
      "A campaign roster with exact plan, creator and package references.",
    success:
      "The user can see who is live, what was agreed and what needs attention next.",
    next: "Review content readiness and issue signed tracking links.",
    estimatedSeconds: 35,
  },
  {
    id: "issue-links",
    index: "06",
    title: "Approve content and issue links",
    location: "Content assets",
    why: "Give every deliverable a measurable route before distribution begins.",
    actionLabel: "REVIEW CONTENT AND LINKS",
    path: (projectId) =>
      guidedDemoCampaignResolverPath(projectId, "content-assets"),
    readiness:
      "Ready. The demo includes both issued and action-required tracking states.",
    evidence:
      "Deliverable records, signed links and visible tracking readiness.",
    success:
      "Every live asset has a current link or a direct issue-link action.",
    next: "Follow the first qualified traffic into retained evidence.",
    estimatedSeconds: 40,
  },
  {
    id: "capture-traffic",
    index: "07",
    title: "Capture qualified traffic",
    location: "Campaign tracking evidence",
    why: "Separate observed attention from assumed reach before measuring wallet actions.",
    actionLabel: "TRACE CAMPAIGN TRAFFIC",
    path: (projectId) => guidedDemoCampaignResolverPath(projectId, "tracking"),
    readiness:
      "Ready. Sanitized signed-link, click and session evidence is retained.",
    evidence: "A qualified click, originating session and creator touch path.",
    success:
      "The user can distinguish qualified clicks, pending checks and anonymous traffic.",
    next: "Review how explicit wallet consent joins the measurement path.",
    estimatedSeconds: 35,
  },
  {
    id: "connect-wallet",
    index: "08",
    title: "Connect a consenting wallet",
    location: "Qualified-wallet evidence",
    why: "Bind campaign measurement to a controller-verified wallet without exposing its address.",
    actionLabel: "OPEN WALLET EVIDENCE",
    path: (projectId) =>
      `/projects/${projectId}/reports/${reportId}?version=${guidedDemoManifest.measuredReportVersion}&evidence=qualified_wallets#evidence`,
    readiness:
      "Ready. The demo uses a signed nonce, explicit consent and a protected mapping.",
    evidence: "Proof, consent and a time-bounded protected wallet mapping.",
    success:
      "The evidence view confirms consent while withholding the wallet address.",
    next: "Inspect the finalized Solana action attached to that path.",
    estimatedSeconds: 40,
  },
  {
    id: "finalize-action",
    index: "09",
    title: "Verify the on-chain action",
    location: "Solana transaction evidence",
    why: "Count only retained, finalized actions that match the campaign rule and consent window.",
    actionLabel: "INSPECT FINALIZED ACTION",
    path: (projectId) =>
      `/projects/${projectId}/reports/${reportId}?version=${guidedDemoManifest.measuredReportVersion}&evidence=activated_wallets#evidence`,
    readiness:
      "Ready. A sanitized finalized transaction is linked to the demo path.",
    evidence: "Canonical transaction identity, finality, slot and action type.",
    success:
      "The user can trace the result to a finalized transaction without seeing private wallet data.",
    next: "Review the conversion and attribution decision built from the evidence.",
    estimatedSeconds: 35,
  },
  {
    id: "attribute-result",
    index: "10",
    title: "Explain the attributed result",
    location: "Evidence path",
    why: "Show why the result belongs to this creator and campaign, not merely that it happened.",
    actionLabel: "TRACE RESULT TO CREATOR",
    path: (projectId) =>
      `/projects/${projectId}/reports/${reportId}?version=${guidedDemoManifest.measuredReportVersion}&evidence=activated_wallets#evidence`,
    readiness:
      "Ready. The retained path is classified with explicit confidence.",
    evidence:
      "Conversion fact, creator touch, attribution fact and confidence classification.",
    success:
      "The user can explain the evidence chain from creator touch to customer action.",
    next: "Review the issued performance decision and its freshness.",
    estimatedSeconds: 35,
  },
  {
    id: "review-report",
    index: "11",
    title: "Review the performance decision",
    location: "Reporting cockpit",
    why: "Put spend, customer action and confidence into one decision-ready operating view.",
    actionLabel: "OPEN ISSUED REPORT",
    path: (projectId) => guidedDemoReportPath(projectId),
    readiness:
      "Synthetic demo: measured report v2 is fixed and freshness-labelled; availability is checked when opened.",
    evidence:
      "Versioned metrics, confidence, source window, data-through time and report hash.",
    success:
      "The user can state what is known, what is unavailable and what action to take.",
    next: "Inspect the retained human-approved replay and compare immutable versions.",
    estimatedSeconds: 45,
  },
  {
    id: "replay-and-compare",
    index: "12",
    title: "Replay and compare",
    location: "Retained replay comparison",
    why: "Let a human-approved rule change create a comparable report without rewriting history.",
    actionLabel: "COMPARE REPLAYED REPORT",
    path: (projectId) => guidedDemoReportPath(projectId, true),
    readiness:
      "Synthetic demo: retained replay v3 is compared with measured v2. Opening this comparison does not approve or run another replay.",
    evidence:
      "Replay approval, durable job, new report version and immutable baseline comparison.",
    success:
      "The user can compare the baseline and replay while both original records remain intact.",
    next: "Return to operational mode with the full evidence chain understood.",
    estimatedSeconds: 40,
  },
] as const;

export const guidedDemoTotalSeconds = guidedDemoSteps.reduce(
  (total, step) => total + step.estimatedSeconds,
  0,
);

export function withGuidedDemo(
  path: string,
  destination: number | "complete" = 1,
): string {
  const hashIndex = path.indexOf("#");
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const base = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const queryIndex = base.indexOf("?");
  const pathname = queryIndex >= 0 ? base.slice(0, queryIndex) : base;
  const query = new URLSearchParams(
    queryIndex >= 0 ? base.slice(queryIndex + 1) : "",
  );
  for (const key of ["demo", "demoStep", "demoComplete", "demoOpen"])
    query.delete(key);
  query.set("demo", "1");
  query.set(
    destination === "complete" ? "demoComplete" : "demoStep",
    destination === "complete" ? "1" : String(destination),
  );
  query.set("demoOpen", "0");
  return `${pathname}?${query}${hash}`;
}
import {
  guidedDemoCampaignResolverPath,
  guidedDemoManifest,
  guidedDemoReportPath,
} from "./guided-demo-manifest";

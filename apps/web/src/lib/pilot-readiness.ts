import { guidedDemoManifest } from "@/lib/guided-demo-manifest";

export const pilotReadinessStepIds = [
  "partner",
  "outcome",
  "campaign",
  "safeguards",
  "decision",
] as const;

export type PilotReadinessStepId = (typeof pilotReadinessStepIds)[number];
export type PilotReadinessItemState = "complete" | "action" | "blocked";

export type PilotReadinessItem = {
  id: string;
  label: string;
  value: string;
  owner: string;
  state: PilotReadinessItemState;
  actionLabel?: string;
  actionPath?: (projectId: string) => string;
};

export type PilotReadinessStep = {
  id: PilotReadinessStepId;
  index: string;
  title: string;
  question: string;
  why: string;
  evidence: string;
  items: PilotReadinessItem[];
};

export type PilotReadinessFixture = {
  label: string;
  partnerLabel: string;
  campaignLabel: string;
  objective: string;
  steps: PilotReadinessStep[];
};

const readySteps: PilotReadinessStep[] = [
  {
    id: "partner",
    index: "01",
    title: "Partner fit",
    question: "Is there a real commercial problem and an accountable team?",
    why: "A pilot needs people who can make campaign, measurement, privacy and commercial decisions—not an anonymous opportunity.",
    evidence:
      "Named owners and a bounded pilot objective in the private operating record.",
    items: [
      {
        id: "objective",
        label: "Pilot objective",
        value: "Prove which creators drive first funded accounts",
        owner: "Partner sponsor",
        state: "complete",
      },
      {
        id: "campaign-owner",
        label: "Campaign owner",
        value: "Named in private record",
        owner: "Partner sponsor",
        state: "complete",
      },
      {
        id: "measurement-owner",
        label: "Measurement owner",
        value: "Named in private record",
        owner: "Partner sponsor",
        state: "complete",
      },
    ],
  },
  {
    id: "outcome",
    index: "02",
    title: "Outcome",
    question: "Can we define one customer action and report value honestly?",
    why: "Agreeing the outcome before launch keeps trading volume, token movement and real revenue from being confused later.",
    evidence:
      "One immutable conversion definition plus an explicit revenue source or unavailable state.",
    items: [
      {
        id: "conversion",
        label: "Primary action",
        value: "First qualifying transaction",
        owner: "Measurement owner",
        state: "complete",
        actionLabel: "REVIEW DEFINITION",
        actionPath: (projectId) =>
          `/projects/${projectId}/settings/conversions`,
      },
      {
        id: "journey",
        label: "Measurable journey",
        value: "Tracked click → signed wallet → finalized action",
        owner: "Measurement owner",
        state: "complete",
      },
      {
        id: "revenue",
        label: "Revenue stance",
        value: "Unavailable until an authoritative source is approved",
        owner: "Commercial approver",
        state: "complete",
      },
    ],
  },
  {
    id: "campaign",
    index: "03",
    title: "Campaign",
    question: "Is the campaign commercially and operationally ready?",
    why: "Exact budget, dates, creators, deliverables and tracking ownership prevent assumptions from becoming live commitments.",
    evidence:
      "An approved commercial plan and a roster with one current tracked link per live asset.",
    items: [
      {
        id: "basket",
        label: "Commercial plan",
        value: "Approved / £15,000 GBP cash",
        owner: "Commercial approver",
        state: "complete",
        actionLabel: "OPEN PLAN",
        actionPath: (projectId) =>
          `/projects/${projectId}/baskets/${guidedDemoManifest.basketId}#commercial-approval`,
      },
      {
        id: "flighting",
        label: "Flighting",
        value: "01 Sep – 30 Sep 2026",
        owner: "Campaign owner",
        state: "complete",
      },
      {
        id: "tracking",
        label: "Tracking readiness",
        value: "Every live asset has a current signed link",
        owner: "Campaign owner",
        state: "complete",
      },
    ],
  },
  {
    id: "safeguards",
    index: "04",
    title: "Safeguards",
    question: "Can the rehearsal run without weakening evidence or privacy?",
    why: "Consent, access, support and live-data controls must be understood before any customer evidence enters Landed.",
    evidence:
      "Approved rehearsal scope, named support route and a separate fail-closed live-data decision.",
    items: [
      {
        id: "consent",
        label: "Wallet consent",
        value: "Plain-English proof, consent and unlink path approved",
        owner: "Privacy owner",
        state: "complete",
      },
      {
        id: "access",
        label: "Access and support",
        value: "Named roles, incident contact and escalation route",
        owner: "Pilot lead",
        state: "complete",
      },
      {
        id: "live-boundary",
        label: "Customer/mainnet boundary",
        value: "Separate approval required / fail closed",
        owner: "Security + operations",
        state: "complete",
        actionLabel: "VIEW LIVE CONTROLS",
        actionPath: (projectId) =>
          `/projects/${projectId}/settings/integrations`,
      },
    ],
  },
  {
    id: "decision",
    index: "05",
    title: "Decision",
    question: "Are we ready for one bounded sanitized rehearsal?",
    why: "A rehearsal decision must name the exact scope and owners. It is not permission to activate live customer or mainnet traffic.",
    evidence:
      "A human-recorded rehearsal GO/NO-GO in the approved private operating system.",
    items: [
      {
        id: "decision-record",
        label: "Rehearsal decision",
        value: "Ready for human GO/NO-GO",
        owner: "Founder + partner sponsor",
        state: "complete",
      },
    ],
  },
];

export const pilotReadinessReadyFixture: PilotReadinessFixture = {
  label: "SANITIZED REHEARSAL",
  partnerLabel: "Design partner / sanitized",
  campaignLabel: "September activation",
  objective: "Prove which creators drive first funded accounts.",
  steps: readySteps,
};

export const pilotReadinessBlockedFixture: PilotReadinessFixture = {
  ...pilotReadinessReadyFixture,
  steps: readySteps.map((step) => {
    if (step.id === "partner") {
      return {
        ...step,
        items: step.items.map((item) =>
          item.id === "measurement-owner"
            ? {
                ...item,
                value: "Not assigned",
                state: "action" as const,
                actionLabel: "ASSIGN OWNER",
                actionPath: (projectId: string) =>
                  `/projects/${projectId}/pilot-readiness?step=partner`,
              }
            : item,
        ),
      };
    }
    if (step.id === "outcome") {
      return {
        ...step,
        items: step.items.map((item) =>
          item.id === "revenue"
            ? {
                ...item,
                value: "Authoritative source or unavailable stance not agreed",
                state: "blocked" as const,
                actionLabel: "REVIEW REVENUE STANCE",
                actionPath: (projectId: string) =>
                  `/projects/${projectId}/settings/conversions#revenue-boundary`,
              }
            : item,
        ),
      };
    }
    if (step.id === "decision") {
      return {
        ...step,
        items: [
          {
            ...step.items[0]!,
            value: "NO-GO until 2 required decisions are complete",
            state: "blocked" as const,
          },
        ],
      };
    }
    return step;
  }),
};

export function resolvePilotReadinessStep(
  requested: string | string[] | undefined,
): PilotReadinessStepId {
  const value = Array.isArray(requested) ? requested[0] : requested;
  return pilotReadinessStepIds.includes(value as PilotReadinessStepId)
    ? (value as PilotReadinessStepId)
    : "partner";
}

export function pilotReadinessOpenItems(fixture: PilotReadinessFixture) {
  return fixture.steps
    .filter((step) => step.id !== "decision")
    .flatMap((step) => step.items.map((item) => ({ ...item, stepId: step.id })))
    .filter((item) => item.state !== "complete");
}

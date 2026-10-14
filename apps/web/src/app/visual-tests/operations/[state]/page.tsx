import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import {
  HeliusOperationSettings,
  type HeliusOperationalStatus,
} from "@/components/helius-operation-settings";
import type {
  TrackingDestinationApprovalDraft,
  TrackingDestinationHost,
} from "@/components/tracking-destination-settings";
import { reportVisualFixturesEnabled } from "@/lib/reports/visual-fixtures";

type PageProps = { params: Promise<{ state: string }> };

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Pilot operations visual QA",
  robots: { follow: false, index: false },
};

const baseStatus: HeliusOperationalStatus = {
  integrationId: "d1000000-0000-4000-8000-000000000001",
  configuredEnvironment: "mainnet",
  controlRequired: true,
  decision: "enabled",
  version: 3,
  operationallyEnabled: true,
  validUntil: "2026-08-24T12:00:00.000Z",
  healthState: "healthy",
  healthObservedAt: "2026-08-21T08:55:00.000Z",
  retainedDeliveryCount: 1248,
  deliveryLimit: 5000,
  retainedRawBytes: 18432000,
  rawByteLimit: 100000000,
  canManage: true,
};

export default async function OperationsVisualStatePage({ params }: PageProps) {
  const { state } = await params;
  const enabled = reportVisualFixturesEnabled({
    explicitFlag: process.env.ENABLE_VISUAL_FIXTURES,
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
  });
  if (
    !enabled ||
    ![
      "healthy",
      "unobserved",
      "stale",
      "degraded",
      "expired",
      "permission",
      "empty",
      "loading",
      "error",
      "destination",
    ].includes(state)
  ) {
    notFound();
  }

  let statuses: HeliusOperationalStatus[] = [];
  if (state === "healthy") statuses = [baseStatus];
  if (state === "stale") {
    statuses = [
      {
        ...baseStatus,
        operationallyEnabled: false,
        healthState: "stale",
        healthObservedAt: "2026-08-20T05:00:00.000Z",
      },
    ];
  }
  if (state === "unobserved") {
    statuses = [
      {
        ...baseStatus,
        operationallyEnabled: false,
        healthState: "unobserved",
        healthObservedAt: null,
      },
    ];
  }
  if (state === "degraded") {
    statuses = [
      {
        ...baseStatus,
        operationallyEnabled: false,
        healthState: "degraded",
        healthObservedAt: "2026-08-21T08:55:00.000Z",
      },
    ];
  }
  if (state === "expired") {
    statuses = [
      {
        ...baseStatus,
        operationallyEnabled: false,
        healthState: "expired",
        validUntil: "2026-08-20T12:00:00.000Z",
        healthObservedAt: "2026-08-20T11:55:00.000Z",
      },
    ];
  }
  if (state === "permission") {
    statuses = [{ ...baseStatus, canManage: false }];
  }
  if (state === "destination") statuses = [baseStatus];

  const destinationApprovalDraft: TrackingDestinationApprovalDraft = {
    hostname: "proof-session.trycloudflare.com",
    requestId: "a2000000-0000-4000-8000-000000000001",
    reason: "Supervised external devnet proof",
  };
  const destinationHosts: TrackingDestinationHost[] = [
    {
      id: "a4000000-0000-4000-8000-000000000001",
      hostname: "campaign.helios.example",
      reason: "Approved campaign destination",
      addedAt: "2026-09-28T10:00:00.000Z",
      revokedAt: null,
    },
  ];

  let content = (
    <HeliusOperationSettings
      canApproveDestinationHosts={state === "destination"}
      destinationApprovalDraft={
        state === "destination" ? destinationApprovalDraft : null
      }
      destinationHosts={state === "destination" ? destinationHosts : []}
      hasActiveDestinationPolicy={state === "destination"}
      projectId="helios"
      statuses={statuses}
    />
  );
  if (state === "loading") {
    content = (
      <section
        aria-busy="true"
        aria-label="Loading integration operations"
        className="operation-settings operation-settings--state"
      >
        <span className="eyebrow">PILOT OPERATIONS</span>
        <h1>Loading provider state…</h1>
      </section>
    );
  }
  if (state === "error") {
    content = (
      <section className="operation-settings operation-settings--state">
        <span className="eyebrow">PILOT OPERATIONS / ERROR</span>
        <h1>Provider state is unavailable.</h1>
        <p>
          No operational decision was changed. Retry the protected status read.
        </p>
        <button className="action-button" type="button">
          RETRY STATUS
        </button>
      </section>
    );
  }

  return (
    <AppShell
      activeSection={null}
      projectId="helios"
      settingsSection="integrations"
      showGuidedDemo={false}
    >
      {content}
    </AppShell>
  );
}

import type { BasketRecord } from "@landed/contracts";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { BasketBuilder } from "@/components/basket-builder";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Unpaid internal test visual fixture",
  robots: { index: false, follow: false },
};

const packageId = "92770000-0000-4000-8000-000000000001";
const basket: BasketRecord = {
  id: "90770000-0000-4000-8000-000000000001",
  workspaceId: "10770000-0000-4000-8000-000000000001",
  projectId: "20770000-0000-4000-8000-000000000001",
  name: "Internal devnet response proof",
  objective: "One creator-linked consented devnet response",
  outcomeProfile: {
    metric: "qualified_wallets",
    baselineUnits: "0",
    targetUnits: "1",
    currencyCode: null,
  },
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  latestApproval: null,
  latestApprovalIsCurrent: null,
  scenarios: [
    {
      id: "91770000-0000-4000-8000-000000000001",
      code: "A",
      name: "Internal proof",
      packageIds: [packageId],
    },
    {
      id: "91770000-0000-4000-8000-000000000002",
      code: "B",
      name: "Reserved",
      packageIds: [],
    },
    {
      id: "91770000-0000-4000-8000-000000000003",
      code: "C",
      name: "Reserved",
      packageIds: [],
    },
  ],
  packages: [
    {
      id: packageId,
      creatorId: "40770000-0000-4000-8000-000000000001",
      creatorName: "Approved internal participant",
      creatorHandle: null,
      audience: null,
      packageLabel: "Internal response proof",
      deliverableSummary: "One consented devnet response",
      sourceRateQuoteId: null,
      commercialDetailRevision: 3,
      commercialDetail: {
        schemaVersion: 2,
        channelIds: [],
        deliveryDeadline: null,
        usageRights: null,
        exclusivity: null,
        commercialBasis: "unpaid_internal_test",
        unpaidReason: "Approved internal devnet response proof.",
      },
      availableChannels: [],
      compensationLines: [],
    },
  ],
};

/** Development-only visual fixture. It cannot issue approvals or write data. */
export default function Page() {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL) notFound();

  return (
    <AppShell activeSection="baskets" projectId="helios" showGuidedDemo={false}>
      <BasketBuilder basket={basket} />
    </AppShell>
  );
}

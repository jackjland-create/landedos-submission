import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  BrowserCommercialApproval,
  BrowserCommercialRecovery,
} from "@/components/browser-commercial-review";
import fixture from "../../../../../../../packages/contracts/src/fixtures/bsk09-timed-review.json";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Approval dialog visual fixture",
  robots: { index: false, follow: false },
};

/** Layout-only fixture. Requests are intercepted by the visual runner; no database is provisioned. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; commercialReview?: string }>;
}) {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL) notFound();
  const { theme, commercialReview } = await searchParams;
  const s = fixture.review_snapshot;
  return (
    <AppShell activeSection="baskets" projectId="helios" showGuidedDemo={false}>
      <header className="page-header">
        <div>
          <h1>{s.basket.name}</h1>
          <p>Selected scenario: {s.scenario.name}</p>
        </div>
      </header>
      <p>
        Layout fixture only. Terms are intercepted test data, not a new
        commercial approval.
      </p>
      {commercialReview ? (
        <BrowserCommercialRecovery basketId={s.basket.id} projectId="helios" />
      ) : (
        <section aria-label="Selected plan">
          <h2>Your selected plan</h2>
          <p>{s.basket.objective}</p>
          <ul>
            {s.packages.map((entry) => (
              <li key={entry.id}>
                {entry.packageLabel}: {entry.deliverableSummary}
              </li>
            ))}
          </ul>
          <BrowserCommercialApproval
            basketId={s.basket.id}
            scenarioId={s.scenario.id}
            revision={s.strategyBinding.revision}
            snapshotHash={fixture.review_snapshot_hash}
            ownerId="30990000-0000-4000-8000-000000000001"
            theme={theme === "dark" ? "dark" : "light"}
          />
        </section>
      )}
    </AppShell>
  );
}

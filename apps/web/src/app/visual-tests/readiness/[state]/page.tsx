import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PilotReadinessCockpit } from "@/components/pilot-readiness-cockpit";
import {
  pilotReadinessBlockedFixture,
  pilotReadinessReadyFixture,
  resolvePilotReadinessStep,
} from "@/lib/pilot-readiness";
import { reportVisualFixturesEnabled } from "@/lib/reports/visual-fixtures";

type PageProps = {
  params: Promise<{ state: string }>;
  searchParams: Promise<{ step?: string | string[] }>;
};

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Pilot readiness visual QA",
  robots: { follow: false, index: false },
};

const allowedStates = [
  "blocked",
  "ready",
  "empty",
  "permission",
  "loading",
  "error",
] as const;

export default async function PilotReadinessVisualStatePage({
  params,
  searchParams,
}: PageProps) {
  const [{ state }, query] = await Promise.all([params, searchParams]);
  const enabled = reportVisualFixturesEnabled({
    explicitFlag: process.env.ENABLE_VISUAL_FIXTURES,
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
  });
  if (!enabled || !allowedStates.includes(state as never)) notFound();

  let content = (
    <PilotReadinessCockpit
      activeStepId={resolvePilotReadinessStep(query.step)}
      fixture={
        state === "ready"
          ? pilotReadinessReadyFixture
          : pilotReadinessBlockedFixture
      }
      projectId="helios"
      stepBasePath={`/visual-tests/readiness/${state}`}
    />
  );

  if (state === "empty") {
    content = (
      <section className="pilot-readiness pilot-readiness--state">
        <span className="eyebrow">PILOT READINESS / FIRST USE</span>
        <h1>No pilot scope is linked yet.</h1>
        <p>
          Start with a sanitized rehearsal. Real partner answers remain in the
          approved private operating system until persistence is reviewed.
        </p>
        <Link className="action-button" href="/visual-tests/readiness/blocked">
          OPEN SANITIZED BLUEPRINT
        </Link>
      </section>
    );
  }
  if (state === "permission") {
    content = (
      <section className="pilot-readiness pilot-readiness--state">
        <span className="eyebrow">PILOT READINESS / PERMISSION</span>
        <h1>Pilot readiness is restricted.</h1>
        <p>
          Project manager access is required. No private partner answer is
          disclosed.
        </p>
      </section>
    );
  }
  if (state === "loading") {
    content = (
      <section
        aria-busy="true"
        aria-label="Loading pilot readiness"
        className="pilot-readiness pilot-readiness--state"
      >
        <span className="eyebrow">PILOT READINESS</span>
        <h1>Loading the rehearsal decision…</h1>
        <div className="pilot-readiness__skeleton" />
      </section>
    );
  }
  if (state === "error") {
    content = (
      <section className="pilot-readiness pilot-readiness--state">
        <span className="eyebrow">PILOT READINESS / ERROR</span>
        <h1>The rehearsal decision could not be loaded.</h1>
        <p>No readiness answer or live-data control was changed.</p>
        <Link className="action-button" href="/visual-tests/readiness/blocked">
          RETRY READINESS
        </Link>
      </section>
    );
  }

  return (
    <AppShell
      activeSection={null}
      projectId="helios"
      settingsSection="readiness"
      showGuidedDemo={false}
    >
      {content}
    </AppShell>
  );
}

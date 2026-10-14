import { notFound } from "next/navigation";

import { PilotReadinessCockpit } from "@/components/pilot-readiness-cockpit";
import { project } from "@/lib/demo-data";
import {
  pilotReadinessBlockedFixture,
  resolvePilotReadinessStep,
} from "@/lib/pilot-readiness";

type PageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ step?: string | string[] }>;
};

export const metadata = { title: "Pilot readiness" };

export default async function PilotReadinessPage({
  params,
  searchParams,
}: PageProps) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  if (projectId !== project.id) notFound();

  return (
    <PilotReadinessCockpit
      activeStepId={resolvePilotReadinessStep(query.step)}
      fixture={pilotReadinessBlockedFixture}
      projectId={projectId}
    />
  );
}

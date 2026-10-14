import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";

export default async function PilotReadinessLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <AppShell
      activeSection={null}
      projectId={projectId}
      settingsSection="readiness"
      showGuidedDemo={false}
    >
      {children}
    </AppShell>
  );
}

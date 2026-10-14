import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";

export default async function IntegrationSettingsLayout({
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
      settingsSection="integrations"
    >
      {children}
    </AppShell>
  );
}

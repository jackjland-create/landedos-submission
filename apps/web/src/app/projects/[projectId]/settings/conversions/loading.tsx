import { AppShell } from "@/components/app-shell";
import { project } from "@/lib/demo-data";

export default function ConversionSettingsLoading() {
  return (
    <AppShell
      activeSection={null}
      projectId={project.id}
      settingsSection="conversions"
      contentAppearance="application"
    >
      <div aria-busy="true" aria-label="Loading Success rules" role="status">
        <div className="loading-panel" />
        <div className="conversion-settings-grid">
          <div className="loading-panel" />
          <div className="loading-panel" />
        </div>
      </div>
    </AppShell>
  );
}

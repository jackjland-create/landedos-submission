import type { NavigationSection } from "@landed/contracts";
import { ApplicationStatus, ApplicationThemeToggle } from "@landed/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import { project } from "@/lib/demo-data";

import { GuidedDemoJourney } from "./guided-demo-journey";
import { ShellDisclosure, ShellMobileMenu } from "./shell-mobile-menu";
import { ShellIcon } from "./shell-icon";
import styles from "./app-shell.module.css";

const navigation = [
  { label: "Overview", section: "overview" },
  { label: "Campaign plans", section: "baskets" },
  { label: "Creators", section: "kols" },
  { label: "Campaigns", section: "campaigns" },
] as const;
const settings = [
  { label: "Pilot readiness", section: "readiness", path: "pilot-readiness" },
  {
    label: "Success rules",
    section: "conversions",
    path: "settings/conversions",
  },
  {
    label: "Integration operations",
    section: "integrations",
    path: "settings/integrations",
  },
] as const;
type SettingsSection = (typeof settings)[number]["section"] | null;

function Wordmark({ projectId }: { projectId: string }) {
  return (
    <Link
      aria-label="Landed project overview"
      className="wordmark"
      translate="no"
      href={`/projects/${projectId}/overview`}
    >
      LANDED<span className="wordmark__suffix">/OS</span>
    </Link>
  );
}

function ProjectSwitcher({ projectId }: { projectId: string }) {
  // The retained pilot currently exposes one project. Do not invent tenants,
  // membership or a create-project action in a shell styling task.
  const name =
    projectId === "demo"
      ? "Demo project"
      : projectId === project.id
        ? project.name
        : projectId;
  return (
    <ShellDisclosure
      className="shell-project"
      label="Choose project"
      summary={
        <>
          <span className="shell-project__tile" aria-hidden="true">
            {name.slice(0, 1).toUpperCase()}
          </span>
          <span className="shell-project__identity">
            <strong>{name}</strong>
            {projectId === project.id || projectId === "demo" ? (
              <span>{project.category}</span>
            ) : null}
          </span>
          <ShellIcon name="chevron" />
        </>
      }
    >
      <div className="shell-disclosure__panel">
        <nav aria-label="Available projects">
          <Link
            href={`/projects/${projectId}/overview`}
            aria-current="location"
          >
            {name}
          </Link>
        </nav>
        <p>No other projects available.</p>
      </div>
    </ShellDisclosure>
  );
}

function ShellSettings({
  projectId,
  settingsSection,
}: {
  projectId: string;
  settingsSection: SettingsSection;
}) {
  return (
    <ShellDisclosure
      className={`shell-settings ${settingsSection ? "shell-settings--active" : ""}`}
      label="Settings"
      defaultOpen={settingsSection !== null}
      summary={
        <>
          <ShellIcon name="settings" />
          <span>Settings</span>
          <ShellIcon name="chevron" />
        </>
      }
    >
      <nav className="shell-settings__links" aria-label="Settings navigation">
        {settings.map((item) => (
          <Link
            className="rail__settings-link"
            aria-current={settingsSection === item.section ? "page" : undefined}
            href={`/projects/${projectId}/${item.path}`}
            key={item.section}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </ShellDisclosure>
  );
}

function ShellAccount({ name }: { name: string }) {
  return (
    <ShellDisclosure
      className="shell-account"
      label="Open account menu"
      summary={
        <>
          <span className="shell-account__avatar" aria-hidden="true">
            {name
              .split(/\s+/)
              .map((part) => part[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </span>
          <span>{name}</span>
          <ShellIcon name="chevron" />
        </>
      }
    >
      <div className="shell-disclosure__panel">
        <form action="/auth/signout" method="post">
          <button
            aria-label="Log out of preview"
            className="logout-action"
            type="submit"
          >
            Log out
          </button>
        </form>
      </div>
    </ShellDisclosure>
  );
}

export function AppShell({
  activeSection,
  children,
  projectId,
  settingsSection = null,
  showGuidedDemo = true,
  proposalOnly = false,
  theme = "light",
  contentClassName = "",
  contentAppearance = "legacy",
  accountName = "Account",
  onThemeChange,
  dataLabel = "Synthetic data",
}: {
  activeSection: NavigationSection | null;
  children: ReactNode;
  projectId: string;
  settingsSection?: SettingsSection;
  showGuidedDemo?: boolean;
  /** Synthetic proposals use the same truthful data chip as the seeded pilot. */
  proposalOnly?: boolean;
  theme?: "light" | "dark";
  contentClassName?: string;
  contentAppearance?: "legacy" | "application";
  accountName?: string;
  onThemeChange?: (theme: "light" | "dark") => void;
  dataLabel?: string | null;
}) {
  // Kept for callers; proposals and seeded pilot both use the single data chip.
  void proposalOnly;
  const links = navigation.map((item) => {
    const isReportParent =
      item.section === "overview" && activeSection === "reports";
    const isActive = item.section === activeSection || isReportParent;
    return (
      <Link
        aria-label={item.label}
        aria-current={
          isReportParent ? "location" : isActive ? "page" : undefined
        }
        className={`rail__link ${isActive ? "rail__link--active" : ""}`}
        href={`/projects/${projectId}/${item.section}`}
        key={item.section}
      >
        <ShellIcon name={item.section} />
        <strong>{item.label}</strong>
      </Link>
    );
  });
  return (
    <div
      className={`app-shell ${styles.frame}`}
      data-shell-theme={theme}
      data-theme={theme}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside
        className={`rail ${styles.chrome} ${styles.sidebar}`}
        data-theme={theme}
      >
        <Wordmark projectId={projectId} />
        <ProjectSwitcher projectId={projectId} />
        <nav aria-label="Primary navigation" className="rail__nav">
          {links}
        </nav>
        <div className="rail__footer">
          <ShellSettings
            projectId={projectId}
            settingsSection={settingsSection}
          />
          {dataLabel && (
            <ApplicationStatus state="unavailable">
              {dataLabel}
            </ApplicationStatus>
          )}
          {onThemeChange && (
            <ApplicationThemeToggle theme={theme} onChange={onThemeChange} />
          )}
          <ShellAccount name={accountName} />
        </div>
      </aside>
      <div
        className={`mobile-bar ${styles.chrome} ${styles.mobile}`}
        data-theme={theme}
      >
        <Wordmark projectId={projectId} />
        <span className="mobile-bar__context">
          {projectId === "demo"
            ? "Demo project"
            : projectId === project.id
              ? project.name
              : projectId}
        </span>
        <ShellMobileMenu>
          <div className="mobile-menu__panel">
            <ProjectSwitcher projectId={projectId} />
            <nav aria-label="Mobile navigation">{links}</nav>
            <ShellSettings
              projectId={projectId}
              settingsSection={settingsSection}
            />
            {dataLabel && (
              <ApplicationStatus state="unavailable">
                {dataLabel}
              </ApplicationStatus>
            )}
            {onThemeChange && (
              <ApplicationThemeToggle theme={theme} onChange={onThemeChange} />
            )}
            <ShellAccount name={accountName} />
          </div>
        </ShellMobileMenu>
      </div>
      <main
        className={`main-content ${styles.content} ${contentClassName}`}
        data-content-appearance={contentAppearance}
        id="main-content"
        tabIndex={-1}
      >
        {children}
      </main>
      {showGuidedDemo ? <GuidedDemoJourney projectId={projectId} /> : null}
    </div>
  );
}

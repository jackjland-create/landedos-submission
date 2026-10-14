import type { NavigationSection } from "@landed/contracts";
import { ActionButton, Eyebrow, MetricCard, Status } from "@landed/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  campaign,
  campaignPhases,
  overviewMetrics,
  project,
} from "@/lib/demo-data";

export const screenTitles: Record<NavigationSection, string> = {
  overview: "Overview",
  kols: "KOL directory",
  baskets: "Basket builder",
  campaigns: "Campaign workspace",
  reports: "Performance report",
};

function PageHeader({
  action,
  copy,
  index,
  title,
}: {
  action: string;
  copy: string;
  index: string;
  title: string;
}) {
  return (
    <header className="page-header">
      <div>
        <Eyebrow>
          {index} / {project.name}
        </Eyebrow>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
      <ActionButton type="button">{action}</ActionButton>
    </header>
  );
}

function Panel({
  children,
  className = "",
  eyebrow,
  title,
}: {
  children: ReactNode;
  className?: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <section className={`panel ${className}`.trim()}>
      <header className="panel__header">
        <div>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2>{title}</h2>
        </div>
      </header>
      {children}
    </section>
  );
}

function OverviewScreen() {
  return (
    <>
      <PageHeader
        action="REVIEW CAMPAIGN"
        copy="One commercial view of campaign spend, qualified wallets and verified value."
        index="01"
        title="OVERVIEW"
      />

      <section className="decision-banner">
        <div>
          <Eyebrow>DECISION / SUMMER ACTIVATION</Eyebrow>
          <h2>
            47 WALLETS QUALIFIED.
            <br />
            THREE CREATORS SHOULD BE RENEWED.
          </h2>
        </div>
        <div className="decision-banner__meta">
          <Status tone="verified">STRONG ATTRIBUTION</Status>
          <span>Last eligible creator touch / 7 days</span>
          <span>{project.freshness}</span>
        </div>
      </section>

      <section aria-label="Campaign metrics" className="metric-grid">
        {overviewMetrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </section>

      <div className="content-grid content-grid--overview">
        <Panel eyebrow="LIVE CAMPAIGN" title={campaign.name}>
          <div className="campaign-line">
            <div>
              <Status tone="action">{campaign.status.toUpperCase()}</Status>
              <strong>{campaign.dates}</strong>
            </div>
            <span>Outcome / {campaign.outcome}</span>
          </div>
          <div
            className="progress-track"
            aria-label="Campaign 62 percent complete"
          >
            <span style={{ width: "62%" }} />
          </div>
          <ol className="micro-timeline">
            <li className="is-complete">Plan</li>
            <li className="is-complete">Approve</li>
            <li className="is-active">Activate</li>
            <li>Finalize</li>
          </ol>
        </Panel>

        <Panel eyebrow="NEXT DECISIONS" title="Act before Friday">
          <ul className="decision-list">
            <li>
              <span className="decision-index">01</span>
              <div>
                <strong>Renew Chain Mode</strong>
                <span>16 qualified wallets / £318 CPQW</span>
              </div>
              <Status tone="verified">RENEW</Status>
            </li>
            <li>
              <span className="decision-index">02</span>
              <div>
                <strong>Review Onchain Alice</strong>
                <span>Good fit / limited historic evidence</span>
              </div>
              <Status tone="forecast">REVIEW</Status>
            </li>
            <li>
              <span className="decision-index">03</span>
              <div>
                <strong>Pause Mint Condition</strong>
                <span>CPA 2.4× campaign median</span>
              </div>
              <Status>STOP</Status>
            </li>
          </ul>
        </Panel>
      </div>
    </>
  );
}

function BasketsScreen() {
  return (
    <>
      <header className="page-header">
        <div>
          <Eyebrow>03 / {project.name}</Eyebrow>
          <h1>BASKET BUILDER</h1>
          <p>
            Build the roster first. Pricing, forecasts and approval follow in
            controlled steps.
          </p>
        </div>
        <Link className="action-button" href={`/projects/${project.id}/kols`}>
          SELECT KOLS
        </Link>
      </header>

      <section className="directory-state" aria-labelledby="basket-first-title">
        <Eyebrow>FIRST COMMERCIAL ROSTER</Eyebrow>
        <h2 id="basket-first-title">No basket has been created yet.</h2>
        <p>
          Select creators in the KOL directory to create persistent A/B/C
          scenarios. Missing pricing and forecast inputs will remain explicit.
        </p>
        <Status>DRAFT SETUP</Status>
      </section>
    </>
  );
}

function CampaignsScreen() {
  return (
    <>
      <PageHeader
        action="REVIEW DELIVERABLE"
        copy="Keep commercial approval, creator output and campaign evidence in one operational timeline."
        index="04"
        title="CAMPAIGN WORKSPACE"
      />

      <section className="campaign-hero">
        <div>
          <Status tone="action">LIVE / DAY 12 OF 28</Status>
          <h2>{campaign.name}</h2>
          <p>{campaign.outcome} / Solana UK growth audience</p>
        </div>
        <dl>
          <div>
            <dt>ROSTER</dt>
            <dd>5 creators</dd>
          </div>
          <div>
            <dt>PUBLISHED</dt>
            <dd>8 / 11</dd>
          </div>
          <div>
            <dt>LINK HEALTH</dt>
            <dd>100%</dd>
          </div>
        </dl>
      </section>

      <div className="content-grid content-grid--campaign">
        <Panel eyebrow="OPERATIONAL PATH" title="What happens next">
          <ol className="phase-list">
            {campaignPhases.map((phase, index) => (
              <li
                className={`phase phase--${phase.state.toLowerCase()}`}
                key={phase.label}
              >
                <span className="phase__index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <strong>{phase.label}</strong>
                  <span>{phase.detail}</span>
                </div>
                <Status
                  tone={
                    phase.state === "Complete"
                      ? "verified"
                      : phase.state === "Active"
                        ? "action"
                        : "default"
                  }
                >
                  {phase.state.toUpperCase()}
                </Status>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel eyebrow="OUTSTANDING" title="Three decisions">
          <ul className="task-list">
            <li>
              <span>01</span>
              <div>
                <strong>Approve Chain Mode cut 02</strong>
                <small>Due today / owner: Jack</small>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Replace expired Sensei link</strong>
                <small>Tracking paused / no eligible clicks</small>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Confirm D7 report window</strong>
                <small>Required before finalization</small>
              </div>
            </li>
          </ul>
          <aside className="evidence-note">
            <Eyebrow>TRACKING EVIDENCE</Eyebrow>
            <strong>11 content assets / 10 active links</strong>
            <span>1 expired link is excluded from attribution.</span>
          </aside>
        </Panel>
      </div>
    </>
  );
}

export function renderScreen(
  section: NavigationSection,
  creatorDirectory: ReactNode = null,
  campaignWorkspace: ReactNode = null,
  reportIndex: ReactNode = null,
) {
  const screens: Record<NavigationSection, ReactNode> = {
    overview: <OverviewScreen />,
    kols: creatorDirectory,
    baskets: <BasketsScreen />,
    campaigns: campaignWorkspace ?? <CampaignsScreen />,
    reports: reportIndex,
  };

  return screens[section];
}

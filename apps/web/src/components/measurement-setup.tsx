"use client";

import { ApplicationStatus } from "@landed/ui";
import Link from "next/link";
import { type ReactNode, useRef } from "react";
import styles from "./measurement-setup.module.css";

export type SetupRuleSummary =
  | { state: "saved"; name: string; version: number; createdAt: string }
  | { state: "missing" | "unavailable" };

const date = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));

/** PIL-01 / PIL-03 / CMP-03 · project guidance, not a measurement verifier. */
export function MeasurementSetup({
  projectId,
  hasActiveWebsite,
  canApproveWebsite,
  rule,
  snapshotAt,
  operationsInitiallyOpen = false,
  children,
}: {
  projectId: string;
  hasActiveWebsite: boolean;
  canApproveWebsite: boolean;
  rule: SetupRuleSummary;
  snapshotAt: string;
  operationsInitiallyOpen?: boolean;
  children: ReactNode;
}) {
  const operations = useRef<HTMLDetailsElement>(null);
  function revealOperations() {
    if (operations.current) operations.current.open = true;
  }
  return (
    <div className={styles.page}>
      <header>
        <p>Project settings</p>
        <h1>Website &amp; measurement</h1>
        <p>
          Review your website, define a result, then arrange a measurement test
          before relying on campaign outcomes.
        </p>
      </header>
      <section
        className={styles.panel}
        aria-labelledby="measurement-setup-heading"
      >
        <header>
          <h2 id="measurement-setup-heading">Set up your project</h2>
          <p>
            Settings read {date(snapshotAt)}. This is not a completed connection
            test.
          </p>
        </header>
        <ol className={styles.steps}>
          <li>
            <h3>Approve your website</h3>
            <ApplicationStatus
              state={hasActiveWebsite ? "confirmed" : "pending"}
              tone={hasActiveWebsite ? "progress" : "attention"}
            >
              {hasActiveWebsite
                ? "Approved website on record"
                : "Website approval needed"}
            </ApplicationStatus>
            <p>
              {hasActiveWebsite
                ? "Check that the exact website you want to use is in the approval history. Another approved website does not cover yours."
                : "Your campaign landing page needs an approved website before Landed can create links to it."}
            </p>
            <p>
              Approval allows a link destination. It does not prove ownership or
              connect website activity.
            </p>
            <small>
              Owner: workspace admin
              {!canApproveWebsite && " · ask your admin to approve it"}
            </small>
            <a href="#tracking-destination-control" onClick={revealOperations}>
              Review website approvals
            </a>
          </li>
          <li>
            <h3>Define a successful result</h3>
            <ApplicationStatus
              state={rule.state === "saved" ? "confirmed" : "unavailable"}
            >
              {rule.state === "saved"
                ? `Saved rule · version ${rule.version}`
                : rule.state === "missing"
                  ? "No saved rule"
                  : "Rule status unavailable"}
            </ApplicationStatus>
            {rule.state === "saved" ? (
              <p>
                <strong>{rule.name}</strong>
                <br />
                Saved {date(rule.createdAt)}. This is the latest saved project
                version, not confirmation of the rule retained by a campaign.
              </p>
            ) : (
              <p>
                {rule.state === "missing"
                  ? "Choose which visitor action should count in Success rules."
                  : "The rule could not be read. Open Success rules to retry; unavailable does not mean no rule exists."}
              </p>
            )}
            <p>
              A saved rule describes what counts. It does not confirm that the
              required evidence is arriving.
            </p>
            <small>Owner: campaign manager</small>
            <Link href={`/projects/${projectId}/settings/conversions`}>
              Open Success rules
            </Link>
          </li>
          <li>
            <h3>Connect and test measurement</h3>
            <ApplicationStatus state="unavailable">
              Not verified here
            </ApplicationStatus>
            <p>
              Ask your technical owner to review the connection and arrange a
              supervised test: creator link → visit → visitor proof and consent
              → qualifying action → attributed result.
            </p>
            <p>
              Provider health alone does not verify this journey or revenue
              measurement. Your sign-in or billing wallet does not identify
              campaign visitors.
            </p>
            <small>Owner: technical owner and campaign manager</small>
            <a href="#data-quality-heading" onClick={revealOperations}>
              Review connection evidence
            </a>
          </li>
        </ol>
        <p className={styles.note}>
          Link readiness is shown separately in each campaign’s Tracking tab. A
          ready link is not a verified outcome connection. No website, rule or
          campaign is changed by viewing this checklist.
        </p>
      </section>
      <details
        className={styles.operations}
        ref={operations}
        open={operationsInitiallyOpen}
      >
        <summary>Advanced · website approval and provider controls</summary>
        <p>
          For your admin and technical owner. These existing controls do not
          install a website connection or run a test.
        </p>
        {children}
      </details>
    </div>
  );
}

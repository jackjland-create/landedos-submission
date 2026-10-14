"use client";

import {
  ApplicationButton,
  ApplicationProcess,
  ApplicationStatus,
} from "@landed/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { z } from "zod";

import { project } from "@/lib/demo-data";
import type { CampaignCreation } from "@/lib/campaign-plan-launch";
import {
  ApplicationPanel,
  ApplicationState,
  ApplicationTheme,
} from "./application-ui";
import styles from "./campaign-launchpad.module.css";

type PendingPlan = {
  id: string;
  version: number;
  approvedAt: string;
  basketId?: string;
  name?: string;
};

export function CampaignLaunchpad({
  canManage,
  pendingPlan,
  theme = "light",
  creation = { kind: "standard" },
}: {
  canManage: boolean;
  pendingPlan: PendingPlan | null;
  theme?: "light" | "dark";
  creation?: CampaignCreation;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [message, setMessage] = useState("");
  const requestId = useRef<string | null>(null);
  const inFlight = useRef(false);

  async function createCampaign() {
    if (
      !pendingPlan ||
      !canManage ||
      creation.kind === "unavailable" ||
      inFlight.current
    )
      return;

    inFlight.current = true;
    setState("saving");
    setMessage("");

    try {
      const local = creation.kind === "local";
      requestId.current ??= crypto.randomUUID();
      const response = await fetch(
        local
          ? "/api/isolated-campaign-commercial"
          : `/api/projects/${project.id}/campaigns`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            local
              ? {
                  action: "create",
                  basketId: creation.basketId,
                  reviewId: creation.reviewId,
                  acknowledged: true,
                }
              : {
                  commercialPlanVersionId: pendingPlan.id,
                  activationRequestId: requestId.current,
                },
          ),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        campaign?: { id?: unknown };
        message?: unknown;
        status?: unknown;
        reviewId?: unknown;
        commercialPlanVersionId?: unknown;
        campaignId?: unknown;
      } | null;

      const campaignId = local ? payload?.campaignId : payload?.campaign?.id;
      const matchesApproval =
        !local ||
        (payload?.status === "approved" &&
          payload.reviewId === creation.reviewId &&
          payload.commercialPlanVersionId === pendingPlan.id);
      if (
        !response.ok ||
        !z.uuid().safeParse(campaignId).success ||
        !matchesApproval
      ) {
        setMessage(
          !local && typeof payload?.message === "string"
            ? payload.message
            : "We couldn’t create the campaign. Your approved plan is unchanged.",
        );
        setState("error");
        inFlight.current = false;
        return;
      }

      router.push(
        `/projects/${project.id}/campaigns/${campaignId}${theme === "dark" ? "?theme=dark" : ""}`,
      );
      router.refresh();
    } catch {
      setMessage(
        "We couldn’t confirm campaign creation. Your approved plan is unchanged.",
      );
      setState("error");
      inFlight.current = false;
    }
  }

  return (
    <ApplicationTheme theme={theme} className={styles.page}>
      <header className={styles.header}>
        {pendingPlan ? (
          <ol className={styles.journey} aria-label="Campaign setup progress">
            <li>Plan complete</li>
            <li>Approved</li>
            <li aria-current="step">Set up campaign</li>
          </ol>
        ) : null}
        <h1>{pendingPlan?.name || "Create a campaign"}</h1>
      </header>

      {pendingPlan ? (
        <ApplicationPanel
          className={styles.summary}
          aria-labelledby="campaign-setup-title"
        >
          <div className={styles.statusRow}>
            <ApplicationStatus tone="progress" state="confirmed">
              Approved · version {pendingPlan.version}
            </ApplicationStatus>
            <span>
              Approved{" "}
              <time dateTime={pendingPlan.approvedAt}>
                {new Intl.DateTimeFormat("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(new Date(pendingPlan.approvedAt))}{" "}
                (UTC)
              </time>
            </span>
          </div>
          <h2 id="campaign-setup-title">Set up your campaign</h2>
          <p>
            Your plan is approved. Create its workspace for the brief, delivery
            and tracking. Your saved details carry forward; the approved plan
            stays unchanged.
          </p>
          <p className={styles.notice}>
            Creating a campaign doesn’t send offers, pay creators or put
            anything live.
          </p>
          {!canManage ? (
            <p role="status">Ask a campaign manager to create this campaign.</p>
          ) : null}
          {canManage && creation.kind === "unavailable" ? (
            <p role="status">
              Campaign creation isn’t available in this environment. Your
              approved plan is saved. Ask your workspace administrator to check
              the setup.
            </p>
          ) : null}
          {state === "error" ? (
            <div className={styles.error} role="alert">
              <p>{message}</p>
              <p>
                Try again. If the campaign was already created, we’ll open it.
              </p>
            </div>
          ) : null}
          {state === "saving" ? (
            <ApplicationProcess label="Creating campaign…" />
          ) : null}
          <div className={styles.actions}>
            {canManage && creation.kind !== "unavailable" ? (
              <ApplicationButton
                variant="hero"
                disabled={state === "saving"}
                onClick={createCampaign}
                aria-describedby="campaign-setup-next"
              >
                {state === "saving" ? "Creating campaign…" : "Create campaign"}
              </ApplicationButton>
            ) : null}
            {pendingPlan.basketId ? (
              <Link
                className={styles.planLink}
                href={`/projects/${project.id}/baskets/${pendingPlan.basketId}${theme === "dark" ? "?theme=dark" : ""}#commercial-approval`}
              >
                View approved plan
              </Link>
            ) : null}
          </div>
          <p id="campaign-setup-next" className={styles.next}>
            Next: review the campaign brief and set up tracking.
          </p>
        </ApplicationPanel>
      ) : (
        <ApplicationState
          state="empty"
          title="Approve a plan first"
          detail="Choose and approve a campaign plan before creating its campaign."
        >
          <Link
            className="application-button application-button--hero"
            href={`/projects/${project.id}/baskets${theme === "dark" ? "?theme=dark" : ""}`}
          >
            Open campaign plans
          </Link>
        </ApplicationState>
      )}
    </ApplicationTheme>
  );
}

export function CampaignLaunchpadPermission({
  theme = "light",
}: { theme?: "light" | "dark" } = {}) {
  return (
    <ApplicationTheme theme={theme} className={styles.page}>
      <header className={styles.header}>
        <h1>Campaign access</h1>
      </header>
      <ApplicationState
        state="permission"
        title="This campaign workspace is outside your project access."
        detail="Ask a workspace administrator to add you to the project."
      >
        <ApplicationStatus state="unavailable">
          Permission required
        </ApplicationStatus>
      </ApplicationState>
    </ApplicationTheme>
  );
}

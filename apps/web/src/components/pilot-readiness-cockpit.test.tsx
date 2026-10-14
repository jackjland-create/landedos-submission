import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  pilotReadinessBlockedFixture,
  pilotReadinessReadyFixture,
  resolvePilotReadinessStep,
} from "@/lib/pilot-readiness";

import { PilotReadinessCockpit } from "./pilot-readiness-cockpit";

afterEach(cleanup);

describe("pilot readiness cockpit", () => {
  it("names unresolved decisions, owners and direct resolution routes", () => {
    render(
      <PilotReadinessCockpit
        activeStepId="outcome"
        fixture={pilotReadinessBlockedFixture}
        projectId="helios"
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "2 decisions before rehearsal.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("NOT READY")).toBeInTheDocument();
    expect(
      screen.getByText("Authoritative source or unavailable stance not agreed"),
    ).toBeInTheDocument();
    expect(screen.getByText("Commercial approver")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "REVIEW REVENUE STANCE" }),
    ).toHaveAttribute(
      "href",
      "/projects/helios/settings/conversions#revenue-boundary",
    );
  });

  it("keeps the five-step journey and live-data boundary visible", () => {
    render(
      <PilotReadinessCockpit
        activeStepId="campaign"
        fixture={pilotReadinessBlockedFixture}
        projectId="helios"
      />,
    );

    const navigation = screen.getByRole("navigation", {
      name: "Pilot readiness steps",
    });
    expect(within(navigation).getAllByRole("link")).toHaveLength(5);
    expect(
      within(navigation).getByRole("link", { name: /campaign/i }),
    ).toHaveAttribute("aria-current", "step");
    expect(
      screen.getByText("REHEARSAL IS NOT LIVE AUTHORISATION"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "VIEW SEPARATE LIVE-DATA CONTROLS" }),
    ).toHaveAttribute("href", "/projects/helios/settings/integrations");
  });

  it("labels a complete sanitized pack as rehearsal ready only", () => {
    render(
      <PilotReadinessCockpit
        activeStepId="decision"
        fixture={pilotReadinessReadyFixture}
        projectId="helios"
      />,
    );

    expect(screen.getByText("REHEARSAL READY")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Ready for one bounded rehearsal.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("HUMAN DECISION ONLY / LIVE DATA STILL FAIL CLOSED"),
    ).toBeInTheDocument();
  });
});

describe("pilot readiness step resolution", () => {
  it("uses the requested known step and fails safely to the first step", () => {
    expect(resolvePilotReadinessStep("safeguards")).toBe("safeguards");
    expect(resolvePilotReadinessStep("unknown")).toBe("partner");
    expect(resolvePilotReadinessStep(undefined)).toBe("partner");
  });
});

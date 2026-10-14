import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildDataQualityCheckpoint,
  HeliusOperationSettings,
  type HeliusOperationalStatus,
} from "./helius-operation-settings";

const status: HeliusOperationalStatus = {
  integrationId: "c1000000-0000-4000-8000-000000000001",
  configuredEnvironment: "mainnet",
  controlRequired: true,
  decision: "enabled",
  version: 3,
  operationallyEnabled: false,
  validUntil: "2026-08-22T09:00:00.000Z",
  healthState: "stale",
  healthObservedAt: null,
  retainedDeliveryCount: 12,
  deliveryLimit: 100,
  retainedRawBytes: 2048,
  rawByteLimit: 100000,
  canManage: true,
};

afterEach(cleanup);

describe("Helius operation settings", () => {
  it("marks only the prerequisites of the chosen decision without changing native validation", () => {
    render(<HeliusOperationSettings projectId="helios" statuses={[status]} />);
    const pack = screen.getByLabelText(/APPROVED READINESS PACK/);
    const acknowledgement = screen.getByRole("checkbox");
    expect(pack).toHaveAttribute("aria-required", "true");
    expect(pack).toHaveAttribute("data-required-missing", "true");
    expect(pack).not.toHaveAttribute("required");
    expect(acknowledgement).toHaveAttribute("aria-required", "false");
    fireEvent.change(pack, { target: { value: "{}" } });
    expect(pack).toHaveAttribute("data-required-missing", "false");
    fireEvent.change(screen.getByLabelText("DECISION"), {
      target: { value: "disabled" },
    });
    expect(pack).toHaveAttribute("aria-required", "false");
    expect(acknowledgement).toHaveAttribute("aria-required", "true");
    expect(acknowledgement).toHaveAttribute("data-required-missing", "true");
    fireEvent.click(acknowledgement);
    expect(acknowledgement).toHaveAttribute("data-required-missing", "false");
    expect(acknowledgement).not.toHaveAttribute("required");
  });

  it("keeps stale health explicit and exposes the manager stop/recovery boundary", () => {
    render(<HeliusOperationSettings projectId="helios" statuses={[status]} />);
    expect(
      screen.getByText("Provider evidence is delayed."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/outside the approved freshness window/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "OPEN PROVIDER CONTROL" }),
    ).toHaveAttribute("href", `#provider-control-${status.integrationId}`);
    expect(screen.getByText("HEALTH UNKNOWN / STALE")).toBeInTheDocument();
    expect(screen.getAllByText("NOT AVAILABLE")).not.toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "REVIEW AND RECORD DECISION" }),
    ).toBeEnabled();
    expect(
      screen.getByLabelText(/APPROVED READINESS PACK/),
    ).toBeInTheDocument();
  });

  it("does not offer operational mutation without manager access", () => {
    render(
      <HeliusOperationSettings
        projectId="helios"
        statuses={[{ ...status, canManage: false }]}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "REVIEW AND RECORD DECISION" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Manager access is required/)).toBeInTheDocument();
  });

  it("makes expired readiness an explicit recovery action", () => {
    render(
      <HeliusOperationSettings
        projectId="helios"
        statuses={[{ ...status, healthState: "expired" }]}
      />,
    );
    expect(
      screen.getByText("READINESS EXPIRED / RECOVERY REQUIRED"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("DECISION")).toHaveValue("enabled");
    expect(
      screen.getByText(/retain a new same-scope pack before recovery/i),
    ).toBeInTheDocument();
  });

  it("distinguishes missing observations from delayed evidence", () => {
    render(
      <HeliusOperationSettings
        projectId="helios"
        statuses={[{ ...status, healthState: "unobserved" }]}
      />,
    );
    expect(
      screen.getByText("Provider evidence has not arrived."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no current monitor observation/i),
    ).toBeInTheDocument();
  });

  it("shows a clear checkpoint when provider evidence is current", () => {
    render(
      <HeliusOperationSettings
        projectId="helios"
        statuses={[
          {
            ...status,
            healthState: "healthy",
            healthObservedAt: "2026-08-22T08:55:00.000Z",
            operationallyEnabled: true,
          },
        ]}
      />,
    );
    expect(
      screen.getByText("Provider evidence is current."),
    ).toBeInTheDocument();
    expect(screen.getByText("NO OPEN INCIDENT")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "VIEW PROVIDER STATUS" }),
    ).toBeInTheDocument();
  });

  it("prioritizes the most material provider incident", () => {
    const checkpoint = buildDataQualityCheckpoint([
      { ...status, healthState: "stale" },
      {
        ...status,
        integrationId: "c1000000-0000-4000-8000-000000000002",
        healthState: "degraded",
      },
    ]);
    expect(checkpoint.heading).toBe(
      "Provider evidence is outside its approved limits.",
    );
    expect(checkpoint.integrationId).toBe(
      "c1000000-0000-4000-8000-000000000002",
    );
  });

  it("makes an unconfigured source explicit rather than reporting zero", () => {
    render(<HeliusOperationSettings projectId="helios" statuses={[]} />);
    expect(
      screen.getByText("No provider evidence source is configured."),
    ).toBeInTheDocument();
    expect(screen.getByText("NOT AVAILABLE")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "OPEN PROVIDER CONTROL" }),
    ).not.toBeInTheDocument();
  });
});

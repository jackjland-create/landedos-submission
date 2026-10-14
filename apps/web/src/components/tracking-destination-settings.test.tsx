import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TrackingDestinationSettings } from "./tracking-destination-settings";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const draft = {
  hostname: "proof-session.trycloudflare.com",
  requestId: "a2000000-0000-4000-8000-000000000001",
  reason: "Supervised external devnet proof",
};

describe("TrackingDestinationSettings", () => {
  it("prefills the exact supervised request and requires explicit confirmation", () => {
    render(
      <TrackingDestinationSettings
        canApprove
        draft={draft}
        hosts={[]}
        projectId="helios"
      />,
    );

    expect(screen.getByLabelText("EXACT HOSTNAME")).toHaveValue(draft.hostname);
    expect(screen.getByLabelText("RUN REQUEST ID")).toHaveValue(
      draft.requestId,
    );
    expect(screen.getByLabelText("RUN REQUEST ID")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("APPROVAL REASON")).toHaveValue(draft.reason);
    expect(
      screen.getByRole("button", { name: "APPROVE DESTINATION HOST" }),
    ).toBeEnabled();
    expect(
      screen.getByText(/does not enable provider traffic/i),
    ).toBeInTheDocument();
  });

  it("does not expose the approval action to a non-admin", () => {
    render(
      <TrackingDestinationSettings
        canApprove={false}
        hosts={[]}
        projectId="helios"
      />,
    );
    expect(
      screen.queryByRole("button", { name: "APPROVE DESTINATION HOST" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/workspace admin access is required/i),
    ).toBeInTheDocument();
  });

  it("submits the exact approved values only after confirmation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Retained conflict" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(
      <TrackingDestinationSettings
        canApprove
        draft={draft}
        hosts={[]}
        projectId="helios"
      />,
    );

    fireEvent.click(
      screen.getByLabelText(/I confirm this exact HTTPS hostname/i),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "APPROVE DESTINATION HOST" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/helios/tracking-destination-hosts",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(draft),
      }),
    );
  });

  it("locks the form to same-request retry when the server outcome is uncertain", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "Destination approval could not be verified.",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    render(
      <TrackingDestinationSettings
        canApprove
        draft={draft}
        hosts={[]}
        projectId="helios"
      />,
    );

    fireEvent.click(
      screen.getByLabelText(/I confirm this exact HTTPS hostname/i),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "APPROVE DESTINATION HOST" }),
    );

    expect(await screen.findByText("OUTCOME UNKNOWN")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "APPROVE DESTINATION HOST" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "RETRY SAME REQUEST" }),
    ).toBeEnabled();
  });

  it("uses the complete policy result rather than recent history for active state", () => {
    render(
      <TrackingDestinationSettings
        canApprove={false}
        hasActivePolicy
        hosts={[]}
        projectId="helios"
      />,
    );
    expect(screen.getByText("ACTIVE POLICY")).toBeInTheDocument();
  });
});

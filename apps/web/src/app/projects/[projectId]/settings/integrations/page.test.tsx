import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { project } from "@/lib/demo-data";
afterEach(cleanup);

const { createClientMock, getRuleMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  getRuleMock: vi.fn(),
}));

vi.mock("@landed/db", () => ({ getProjectConversionRule: getRuleMock }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

import IntegrationSettingsPage from "./page";
import IntegrationSettingsError from "./error";
import LoadingIntegrationSettings from "./loading";

const projectId = "helios";
const destinationHostname = "fresh-session.trycloudflare.com";
const destinationRequestId = "6c3f8c38-a5d7-491e-b47a-8cc9949c5ed5";

function clientFixture() {
  let destinationQuery = 0;
  return {
    rpc: vi.fn((name: string) => {
      if (name === "is_workspace_admin") {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({
        data: [
          {
            integration_id: "90990000-0000-4000-8000-000000000020",
            configured_environment: "devnet",
            control_required: false,
            decision: "disabled",
            version: null,
            operationally_enabled: true,
            valid_until: null,
            health_state: "not_required",
            health_observed_at: null,
            retained_delivery_count: 15,
            delivery_limit: 100,
            retained_raw_bytes: 7963,
            raw_byte_limit: 1_000_000,
            can_manage: true,
          },
        ],
        error: null,
      });
    }),
    from: vi.fn(() => {
      destinationQuery += 1;
      const result =
        destinationQuery === 1
          ? {
              data: [
                {
                  id: "4403cf99-0efa-4004-8c4c-bb346ba94473",
                  hostname: "synthetic.local.example",
                  reason: "Approve synthetic local-only campaign destination",
                  added_at: "2026-09-25T15:21:11.426967+00:00",
                  revoked_at: null,
                },
              ],
              error: null,
            }
          : {
              data: [{ id: "4403cf99-0efa-4004-8c4c-bb346ba94473" }],
              error: null,
            };
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        order: vi.fn(() => builder),
        is: vi.fn(() => builder),
        limit: vi.fn(() => Promise.resolve(result)),
      };
      return builder;
    }),
  };
}

describe("external workspace-admin integration handoff", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createClientMock.mockResolvedValue(clientFixture());
    getRuleMock.mockReset();
    getRuleMock.mockResolvedValue(null);
  });

  it("does not expose setup metadata when provider access is restricted", async () => {
    const client = clientFixture();
    client.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501" },
    } as never);
    createClientMock.mockResolvedValue(client);
    render(
      await IntegrationSettingsPage({
        params: Promise.resolve({ projectId }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(
      screen.getByRole("heading", {
        name: "Website & measurement is restricted.",
      }),
    ).toBeInTheDocument();
    expect(getRuleMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Set up your project")).not.toBeInTheDocument();
  });

  it("fails the settings read rather than inventing website approval status", async () => {
    const client = clientFixture();
    client.from.mockImplementation(() => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        is: () => builder,
        limit: async () => ({ data: null, error: { code: "unexpected" } }),
      };
      return builder as never;
    });
    createClientMock.mockResolvedValue(client);
    await expect(
      IntegrationSettingsPage({
        params: Promise.resolve({ projectId }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("Tracking destination policy could not be loaded.");
    expect(getRuleMock).not.toHaveBeenCalled();
  });

  it("names setup while loading and offers retry on failure", () => {
    const loading = render(<LoadingIntegrationSettings />);
    expect(
      screen.getByLabelText("Loading website and measurement settings"),
    ).toHaveAttribute("aria-busy", "true");
    loading.unmount();
    const retry = vi.fn();
    render(
      <IntegrationSettingsError
        error={new Error("read failed")}
        reset={retry}
      />,
    );
    screen.getByRole("button", { name: "Retry settings" }).click();
    expect(retry).toHaveBeenCalledOnce();
  });

  it("renders the retained admin data and preserves the approval draft", async () => {
    render(
      await IntegrationSettingsPage({
        params: Promise.resolve({ projectId }),
        searchParams: Promise.resolve({
          destinationHostname,
          destinationRequestId,
          destinationReason: "Supervised external devnet proof",
        }),
      }),
    );

    expect(
      screen.getByRole("heading", {
        name: "Approve one exact campaign destination.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("EXACT HOSTNAME")).toHaveValue(
      destinationHostname,
    );
    expect(screen.getByLabelText("RUN REQUEST ID")).toHaveValue(
      destinationRequestId,
    );
    expect(screen.getByLabelText("APPROVAL REASON")).toHaveValue(
      "Supervised external devnet proof",
    );
    expect(
      screen.getByRole("button", { name: "APPROVE DESTINATION HOST" }),
    ).toBeEnabled();
  });

  it("uses the authenticated project reader and shows only latest saved rule metadata", async () => {
    const client = clientFixture();
    createClientMock.mockResolvedValue(client);
    getRuleMock.mockResolvedValue({
      versions: [
        {
          name: "Qualified action",
          version: 3,
          createdAt: "2026-10-09T12:00:00Z",
        },
      ],
    });
    render(
      await IntegrationSettingsPage({
        params: Promise.resolve({ projectId }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(getRuleMock).toHaveBeenCalledWith(client, project.databaseId);
    expect(screen.getByText("Saved rule · version 3")).toBeInTheDocument();
    expect(screen.getByText("Not verified here")).toBeInTheDocument();
  });

  it("retains recovery controls when success rules cannot be read", async () => {
    getRuleMock.mockRejectedValue(new Error("unavailable"));
    render(
      await IntegrationSettingsPage({
        params: Promise.resolve({ projectId }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.getByText("Rule status unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No saved rule")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Review connection evidence" }),
    ).toBeInTheDocument();
  });
});

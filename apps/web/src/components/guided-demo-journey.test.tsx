import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GuidedDemoJourney } from "./guided-demo-journey";

const storageKey = "landed.guided-demo.v1";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("guided demo journey", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/projects/helios/overview");
  });

  it("recovers the URL step and remains usable when local storage is blocked", async () => {
    window.history.replaceState(
      null,
      "",
      "/projects/helios/reports/exact?version=2&demo=1&demoStep=12&demoOpen=0",
    );
    for (const method of ["getItem", "setItem", "removeItem"] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException("Blocked", "SecurityError");
      });
    }
    render(<GuidedDemoJourney projectId="helios" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Resume guided demo" }),
    );
    expect(
      screen.getByRole("heading", { name: "Replay and compare" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "COMPARE REPLAYED REPORT" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("version=3&compare=2&demo=1&demoComplete=1"),
    );
    fireEvent.click(screen.getByRole("button", { name: "PREVIOUS" }));
    expect(new URLSearchParams(window.location.search).get("demoStep")).toBe(
      "11",
    );
    expect(new URLSearchParams(window.location.search).get("version")).toBe(
      "2",
    );
  });

  it("keeps operational mode available until the user opens the guide", async () => {
    render(<GuidedDemoJourney projectId="helios" />);

    const launcher = await screen.findByRole("button", {
      name: "Open guided demo",
    });
    expect(
      screen.queryByRole("dialog", { name: "Guided demo journey" }),
    ).not.toBeInTheDocument();

    fireEvent.click(launcher);
    expect(
      screen.getByRole("dialog", { name: "Guided demo journey" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Define the outcome" }),
    ).toBeVisible();
  });

  it("opens a requested step and advances through the real action link", async () => {
    window.history.replaceState(
      null,
      "",
      "/projects/helios/baskets?demo=1&demoStep=4#commercial-approval",
    );
    render(<GuidedDemoJourney projectId="helios" />);

    expect(
      await screen.findByRole("heading", {
        name: "Resolve blockers and approve",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("progressbar", { name: "3 of 12 steps complete" }),
    ).toHaveAttribute("aria-valuenow", "3");

    const action = screen.getByRole("link", {
      name: "REVIEW APPROVAL READINESS",
    });
    expect(action).toHaveAttribute(
      "href",
      "/projects/helios/baskets/f1100000-0000-4000-8000-000000000001?demo=1&demoStep=5&demoOpen=0#commercial-approval",
    );
    fireEvent.click(action);

    await waitFor(() =>
      expect(
        JSON.parse(window.localStorage.getItem(storageKey) ?? "null"),
      ).toMatchObject({
        active: true,
        currentStep: 4,
      }),
    );
  });

  it("persists progress, supports reset and exits without changing records", async () => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ active: true, open: true, currentStep: 8 }),
    );
    render(<GuidedDemoJourney projectId="helios" />);

    expect(
      await screen.findByRole("heading", {
        name: "Verify the on-chain action",
      }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "RESET GUIDE" }));
    expect(
      screen.getByRole("heading", { name: "Define the outcome" }),
    ).toBeVisible();
    expect(window.location.search).toBe("?demo=1&demoStep=1");

    fireEvent.click(screen.getByRole("button", { name: "EXIT DEMO" }));
    expect(
      screen.queryByRole("dialog", { name: "Guided demo journey" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open guided demo" }),
    ).toBeVisible();
    expect(window.location.search).toBe("");
  });

  it("moves focus into the guide, traps it and restores the launcher", async () => {
    render(
      <div className="app-shell">
        <button type="button">Underlying control</button>
        <GuidedDemoJourney projectId="helios" />
      </div>,
    );
    const launcher = await screen.findByRole("button", {
      name: "Open guided demo",
    });
    launcher.focus();
    fireEvent.click(launcher);

    const close = screen.getByRole("button", { name: "Close guided demo" });
    await waitFor(() => expect(close).toHaveFocus());
    expect(
      screen.getByRole("button", { name: "Underlying control", hidden: true }),
    ).toHaveAttribute("inert");
    const exit = screen.getByRole("button", { name: "EXIT DEMO" });
    exit.focus();
    fireEvent.keyDown(exit, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Resume guided demo" }),
      ).toHaveFocus(),
    );
    expect(
      screen.getByRole("button", { name: "Underlying control" }),
    ).not.toHaveAttribute("inert");
  });

  it("finishes in operational mode with an explicit evidence-preservation statement", async () => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ active: true, open: true, currentStep: 12 }),
    );
    render(<GuidedDemoJourney projectId="helios" />);

    expect(
      await screen.findByRole("heading", {
        name: "From campaign intent to immutable evidence.",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(/operational records were not changed by the guide/i),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "RETURN TO OPERATIONAL MODE" }),
    ).toHaveAttribute("href", "/projects/helios/overview");
  });
});

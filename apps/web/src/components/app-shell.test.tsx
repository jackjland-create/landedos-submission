import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppShell } from "./app-shell";
import { ShellMobileMenu } from "./shell-mobile-menu";
import Link from "next/link";

afterEach(cleanup);

describe("application frame", () => {
  it("dismisses successful menu navigation but respects canceled navigation", () => {
    render(
      <ShellMobileMenu>
        <a href="#workspace">Go to workspace</a>
        <a href="#blocked">Canceled navigation</a>
      </ShellMobileMenu>,
    );
    const details = screen
      .getByLabelText("Open project navigation")
      .closest("details")!;
    details.open = true;
    const cancel = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("click", cancel, true);
    fireEvent.click(screen.getByText("Canceled navigation"));
    document.removeEventListener("click", cancel, true);
    expect(details.open).toBe(true);
    fireEvent.click(screen.getByText("Go to workspace"));
    expect(details.open).toBe(false);
    details.open = true;
    fireEvent.blur(details, { relatedTarget: document.body });
    expect(details.open).toBe(false);
  });
  it("keeps exact project destinations, theme and child report context", () => {
    const { container } = render(
      <AppShell
        activeSection="reports"
        projectId="helios"
        theme="dark"
        showGuidedDemo={false}
      >
        <Link href="/projects/helios/reports/exact-report?version=5&compare=3">
          Exact report
        </Link>
      </AppShell>,
    );
    expect(
      container.querySelector('[data-shell-theme="dark"]'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    const links = within(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      ["overview", "baskets", "kols", "campaigns"].map(
        (section) => `/projects/helios/${section}`,
      ),
    );
    expect(links[0]).toHaveAttribute("aria-current", "location");
    expect(screen.queryByText("Issued reports")).not.toBeInTheDocument();
    expect(screen.getByText("Exact report")).toHaveAttribute(
      "href",
      "/projects/helios/reports/exact-report?version=5&compare=3",
    );
  });

  it("dismisses mobile navigation with Escape and outside pointer, returning keyboard focus", () => {
    render(
      <AppShell
        activeSection="campaigns"
        projectId="helios"
        showGuidedDemo={false}
      >
        <p>Workspace</p>
      </AppShell>,
    );
    const summary = screen.getByLabelText("Open project navigation");
    const details = summary.closest("details")!;
    details.open = true;
    fireEvent.keyDown(summary, { key: "Escape" });
    expect(details.open).toBe(false);
    expect(summary).toHaveFocus();
    details.open = true;
    fireEvent.pointerDown(screen.getByText("Workspace"));
    expect(details.open).toBe(false);
  });
  it("exposes four primary destinations and the truthful current-project chooser", () => {
    render(
      <AppShell activeSection="overview" projectId="helios">
        <div>Current screen</div>
      </AppShell>,
    );

    const chooser = screen.getAllByLabelText("Choose project")[0];
    expect(within(chooser).getByText("Helios Mobile")).toBeInTheDocument();
    const projects = chooser.closest("details")!;
    projects.open = true;
    expect(within(projects).getByRole("link")).toHaveAttribute(
      "href",
      "/projects/helios/overview",
    );
    expect(
      within(projects).getByText("No other projects available."),
    ).toBeInTheDocument();
    const primaryNavigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });

    expect(primaryNavigation).toBeInTheDocument();

    for (const label of [
      "Overview",
      "Campaign plans",
      "Creators",
      "Campaigns",
    ]) {
      expect(
        within(primaryNavigation).getByRole("link", { name: label }),
      ).toBeInTheDocument();
    }

    expect(within(primaryNavigation).getAllByRole("link")).toHaveLength(4);
    expect(
      within(primaryNavigation).getByRole("link", { name: "Creators" }),
    ).toHaveAttribute("href", "/projects/helios/kols");
    expect(screen.queryByText("Issued reports")).not.toBeInTheDocument();

    for (const control of screen.getAllByLabelText("Settings"))
      control.closest("details")!.open = true;

    expect(screen.getAllByRole("link", { name: "Success rules" })).toHaveLength(
      2,
    );
    expect(
      screen.getAllByRole("link", { name: /pilot readiness/i }),
    ).toHaveLength(2);

    for (const control of screen.getAllByLabelText("Open account menu")) {
      expect(control.closest("details")!.open).toBe(false);
    }
    for (const control of screen.getAllByLabelText("Open account menu"))
      control.closest("details")!.open = true;
    const logoutButtons = screen.getAllByRole("button", {
      name: "Log out of preview",
    });

    expect(logoutButtons).toHaveLength(2);

    for (const button of logoutButtons) {
      expect(button).toHaveAttribute("type", "submit");
      expect(button.closest("form")).toHaveAttribute("action", "/auth/signout");
      expect(button.closest("form")).toHaveAttribute("method", "post");
    }
  });

  it("uses only one synthetic chip per shell and the approved wordmark/icon treatment", () => {
    const { container } = render(
      <AppShell
        activeSection="overview"
        projectId="helios"
        proposalOnly
        showGuidedDemo={false}
      >
        <p>Fixture</p>
      </AppShell>,
    );
    expect(screen.getAllByText("Synthetic data")).toHaveLength(2);
    expect(
      screen.queryByText(
        /Design proposal|Not live data|No source freshness asserted/,
      ),
    ).not.toBeInTheDocument();
    expect(container.querySelectorAll(".wordmark__suffix")).toHaveLength(2);
    expect(container.querySelector(".wordmark__signal")).toBeNull();
    for (const link of within(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).getAllByRole("link")) {
      expect(link.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it("returns focus when closing nested account/settings disclosures without closing the mobile parent", () => {
    render(
      <AppShell
        activeSection="overview"
        projectId="helios"
        showGuidedDemo={false}
      >
        <p>Workspace</p>
      </AppShell>,
    );
    const menu = screen
      .getByLabelText("Open project navigation")
      .closest("details")!;
    menu.open = true;
    const account = within(menu).getByLabelText("Open account menu");
    const details = account.closest("details")!;
    details.open = true;
    fireEvent.keyDown(account, { key: "Escape" });
    expect(details.open).toBe(false);
    expect(menu.open).toBe(true);
    expect(account).toHaveFocus();
    details.open = true;
    fireEvent.pointerDown(screen.getByText("Workspace"));
    expect(details.open).toBe(false);
    expect(menu.open).toBe(false);
  });

  it("marks Success rules as active without changing the conversion settings route", () => {
    render(
      <AppShell
        activeSection={null}
        projectId="helios"
        settingsSection="conversions"
      >
        <div>Conversion screen</div>
      </AppShell>,
    );
    for (const link of screen.getAllByRole("link", { name: "Success rules" })) {
      expect(link).toHaveAttribute("aria-current", "page");
      expect(link).toHaveAttribute(
        "href",
        "/projects/helios/settings/conversions",
      );
    }
  });

  it.each(["baskets", "kols"] as const)(
    "preserves %s identity and approved order in desktop and mobile navigation",
    (activeSection) => {
      render(
        <AppShell
          activeSection={activeSection}
          projectId="another-project"
          showGuidedDemo={false}
        >
          <p>Project content</p>
        </AppShell>,
      );
      screen
        .getByLabelText("Open project navigation")
        .closest("details")!.open = true;
      for (const name of ["Primary navigation", "Mobile navigation"]) {
        const links = within(
          screen.getByRole("navigation", { name }),
        ).getAllByRole("link");
        expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
          "Overview",
          "Campaign plans",
          "Creators",
          "Campaigns",
        ]);
        expect(links.map((link) => link.getAttribute("href"))).toEqual(
          ["overview", "baskets", "kols", "campaigns"].map(
            (section) => `/projects/another-project/${section}`,
          ),
        );
        const current = links.filter(
          (link) => link.getAttribute("aria-current") === "page",
        );
        expect(current).toHaveLength(1);
        expect(current[0]).toHaveAttribute(
          "href",
          `/projects/another-project/${activeSection}`,
        );
      }
      expect(
        screen.queryByRole("link", { name: "Marketplace" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Baskets" }),
      ).not.toBeInTheDocument();
    },
  );

  it("marks pilot readiness as the active secondary route", () => {
    render(
      <AppShell
        activeSection={null}
        projectId="helios"
        settingsSection="readiness"
      >
        <div>Pilot readiness screen</div>
      </AppShell>,
    );
    for (const link of screen.getAllByRole("link", {
      name: /pilot readiness/i,
    })) {
      expect(link).toHaveAttribute("aria-current", "page");
    }
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  ApplicationButton,
  ApplicationStatus,
  ApplicationThemeToggle,
} from "@landed/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationState, ApplicationTheme } from "./application-ui";

afterEach(cleanup);

describe("governed application kit (FND-05 / UI-03)", () => {
  it("lets the owner control the theme without a second preference store", () => {
    const change = vi.fn();
    const { rerender } = render(
      <ApplicationThemeToggle theme="light" onChange={change} />,
    );
    const control = screen.getByRole("switch", { name: "Dark mode" });
    expect(control).toHaveAttribute("aria-checked", "false");
    fireEvent.click(control);
    expect(change).toHaveBeenCalledWith("dark");
    rerender(<ApplicationThemeToggle theme="dark" onChange={change} />);
    expect(control).toHaveAttribute("aria-checked", "true");
  });
  it("defaults to a non-submitting button and keeps handlers and disabled behavior", () => {
    const onClick = vi.fn();
    render(
      <ApplicationTheme theme="dark">
        <ApplicationButton variant="hero" onClick={onClick}>
          Review plan
        </ApplicationButton>
        <ApplicationButton disabled onClick={onClick}>
          Unavailable
        </ApplicationButton>
      </ApplicationTheme>,
    );
    const button = screen.getByRole("button", { name: "Review plan" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("application-button--hero");
    expect(button.closest("[data-theme]")).toHaveAttribute(
      "data-theme",
      "dark",
    );
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "Unavailable" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it.each(["confirmed", "pending", "unavailable"] as const)(
    "retains a readable word with the %s dot",
    (state) => {
      render(
        <ApplicationStatus state={state}>Evidence status</ApplicationStatus>,
      );
      const status = screen.getByText("Evidence status");
      expect(status).toHaveAttribute("data-status-state", state);
      expect(status.querySelector(".application-status__dot")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    },
  );

  it.each(["loading", "empty", "error", "permission"] as const)(
    "renders the %s state without fabricating completion or an action",
    (state) => {
      const { container } = render(
        <ApplicationTheme>
          <ApplicationState
            state={state}
            title="Campaign data"
            detail="No result is asserted."
          />
        </ApplicationTheme>,
      );
      expect(
        screen.getByRole(state === "error" ? "alert" : "status"),
      ).toHaveTextContent("Campaign data");
      expect(screen.getByText("No result is asserted.")).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(
        container.querySelector(".application-process__orb") !== null,
      ).toBe(state === "loading");
    },
  );
});

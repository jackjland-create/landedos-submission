import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderScreen } from "./screens";

describe("golden screen fixtures", () => {
  it("renders the retained report surface supplied by the server route", () => {
    render(
      renderScreen(
        "reports",
        null,
        null,
        <section>Retained report evidence</section>,
      ),
    );

    expect(screen.getByText("Retained report evidence")).toBeInTheDocument();
  });

  it("does not imply pricing or forecasts before a basket exists", () => {
    render(renderScreen("baskets"));

    expect(
      screen.getByRole("heading", {
        name: "No basket has been created yet.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "SELECT KOLS" })).toHaveAttribute(
      "href",
      "/projects/helios/kols",
    );
    expect(screen.queryByText("£0")).not.toBeInTheDocument();
  });
});

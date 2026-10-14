import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { BasketPlanNavigation } from "./basket-plan-navigation";

afterEach(cleanup);
it("provides native same-page links without inventing completion states", () => {
  render(<BasketPlanNavigation />);
  const nav = screen.getByRole("navigation", {
    name: "Basket planning sections",
  });
  const links = within(nav).getAllByRole("link");
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    "#basket-strategy",
    "#basket-outcome",
    "#basket-roster",
    "#basket-timing",
    "#basket-plan-review",
  ]);
  expect(within(nav).queryByRole("button")).not.toBeInTheDocument();
  expect(nav.textContent).not.toMatch(/complete|approved|ready/i);
  expect(within(nav).getByText("Purpose & measurement")).toBeInTheDocument();
});

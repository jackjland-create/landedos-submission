import { describe, expect, it } from "vitest";

import { tooltipYPosition } from "./chart-tooltip";

describe("chart tooltip positions", () => {
  it("distinguishes a retained zero from a missing observation", () => {
    expect(
      tooltipYPosition(
        { yPositions: { activatedWallets: 0 } },
        "activatedWallets",
      ),
    ).toBe(0);
    expect(tooltipYPosition({ yPositions: {} }, "activatedWallets")).toBeNull();
  });
});

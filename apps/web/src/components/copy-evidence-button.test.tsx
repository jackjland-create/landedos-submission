import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyEvidenceButton } from "./copy-evidence-button";

describe("copy evidence button", () => {
  afterEach(() => vi.restoreAllMocks());

  it("copies the exact retained transaction signature", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const signature = "5".repeat(88);

    render(<CopyEvidenceButton value={signature} />);
    fireEvent.click(screen.getByRole("button", { name: "COPY SIGNATURE" }));

    await screen.findByRole("button", { name: "COPIED" });
    expect(writeText).toHaveBeenCalledWith(signature);
  });

  it("keeps a failed clipboard write explicit", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) },
    });

    render(<CopyEvidenceButton value={"5".repeat(88)} />);
    fireEvent.click(screen.getByRole("button", { name: "COPY SIGNATURE" }));

    await screen.findByRole("button", { name: "COPY FAILED" });
  });
});

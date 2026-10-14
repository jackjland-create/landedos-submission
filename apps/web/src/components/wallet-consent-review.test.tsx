import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WalletConsentReview } from "./wallet-consent-review";

const props = {
  challengeStatement:
    "Prove wallet control for campaign measurement. This does not request a transaction or access to funds.",
  consentStatement:
    "I consent to Landed linking this wallet to this campaign session to measure configured campaign outcomes. Analysis may include up to 90 days of relevant pre-touch activity and relevant activity until this qualified campaign session expires. I can unlink at any time to stop future association.",
  historicalLookbackDays: 90,
} as const;

afterEach(cleanup);

describe("WAL-01–03 wallet consent interaction review", () => {
  it("separates wallet control, consent and the gated action handoff", () => {
    render(<WalletConsentReview {...props} />);

    expect(
      screen.getByRole("heading", { name: "Review wallet measurement" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "A message signature, never a transaction",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(props.challengeStatement)).toBeInTheDocument();
    expect(screen.getByText("No transaction")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Continue to consent preview" }),
    );
    expect(new URL(window.location.href).searchParams.get("phase")).toBe(
      "consent",
    );
    const consent = screen.getByRole("checkbox", {
      name: props.consentStatement,
    });
    const continueButton = screen.getByRole("button", {
      name: "Continue to action handoff",
    });
    expect(continueButton).toBeDisabled();
    fireEvent.click(consent);
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);
    expect(new URL(window.location.href).searchParams.get("phase")).toBe(
      "handoff",
    );

    expect(
      screen.getByRole("heading", {
        name: "The genuine devnet action is still gated",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("No wallet action occurred")).toBeInTheDocument();
  });

  it("toggles the isolated review between light and dark themes", () => {
    const { container } = render(<WalletConsentReview {...props} />);
    const root = container.firstElementChild;
    const toggle = screen.getByRole("switch", { name: "Dark mode" });
    expect(root).toHaveAttribute("data-theme", "light");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(root).toHaveAttribute("data-theme", "dark");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(new URL(window.location.href).searchParams.get("theme")).toBe(
      "dark",
    );
  });

  it.each([
    ["loading", "Checking this campaign link…"],
    ["expired", "Open the creator link again"],
    ["error", "Wallet verification could not start"],
    ["permission", "This link cannot request measurement"],
  ] as const)(
    "renders the %s state without a wallet action",
    (state, title) => {
      render(<WalletConsentReview {...props} state={state} />);
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /connect|sign|submit/i }),
      ).not.toBeInTheDocument();
    },
  );
});

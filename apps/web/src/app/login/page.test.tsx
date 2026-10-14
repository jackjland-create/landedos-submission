import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LoginPage from "./page";
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

vi.mock("./actions", () => ({
  login: vi.fn(),
  signup: vi.fn(),
}));

describe("preview login", () => {
  it.each(["create", "recover", "update-password"])(
    "keeps new %s mode hidden by default",
    async (mode) => {
      vi.stubEnv("LANDED_ACCOUNT_FLOWS_ENABLED", "");
      render(await LoginPage({ searchParams: Promise.resolve({ mode }) }));
      expect(
        screen.getByRole("heading", { name: "Sign in" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Forgot password?" }),
      ).not.toBeInTheDocument();
    },
  );
  it.each([
    ["create", "Request an account"],
    ["recover", "Recover your password"],
    ["update-password", "Set a new password"],
  ])(
    "renders gated %s form with safe sign-in return",
    async (mode, heading) => {
      vi.stubEnv("LANDED_ACCOUNT_FLOWS_ENABLED", "1");
      vi.stubEnv("LANDED_PASSWORD_RECOVERY_ENABLED", "1");
      vi.stubEnv("LANDED_LOCAL_DEVNET_INPUT_LOCK", "");
      render(
        await LoginPage({
          searchParams: Promise.resolve({ mode, next: "https://evil.example" }),
        }),
      );
      expect(
        screen.getByRole("heading", { name: heading }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Back to sign-in" }),
      ).toHaveAttribute("href", "/login?next=%2Fprojects%2Fhelios%2Foverview");
    },
  );
  it("offers new links only with approved flags and suppresses them in closed review", async () => {
    vi.stubEnv("LANDED_ACCOUNT_FLOWS_ENABLED", "1");
    vi.stubEnv("LANDED_PASSWORD_RECOVERY_ENABLED", "1");
    vi.stubEnv("LANDED_LOCAL_DEVNET_INPUT_LOCK", "");
    render(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Request access" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Forgot password?" }),
    ).toBeInTheDocument();
    cleanup();
    vi.stubEnv("LANDED_LOCAL_DEVNET_INPUT_LOCK", "review");
    render(
      await LoginPage({ searchParams: Promise.resolve({ mode: "create" }) }),
    );
    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("presents controlled access without attribution claims", async () => {
    const page = await LoginPage({
      searchParams: Promise.resolve({}),
    });

    render(page);

    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Work email")).toBeInTheDocument();
    expect(screen.getByText("Evidence before claims.")).toBeInTheDocument();
    expect(screen.queryByText(/return to the page/)).not.toBeInTheDocument();
  });

  it("retains a safe operator destination through sign-in", async () => {
    const page = await LoginPage({
      searchParams: Promise.resolve({
        next: "/projects/helios/baskets/basket-id?view=approval",
      }),
    });

    render(page);

    expect(screen.getByDisplayValue(/basket-id/)).toHaveAttribute(
      "name",
      "next",
    );
    expect(
      screen.getByText(/return to the page you were reviewing/),
    ).toBeInTheDocument();
  });
});

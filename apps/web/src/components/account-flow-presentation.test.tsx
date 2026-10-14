import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountFlowPresentation } from "./account-flow-presentation";
import type {
  AccountFlowAction,
  AccountFlowMode,
  AccountFlowState,
} from "@/lib/auth/account-flow";
afterEach(cleanup);
function setup(
  mode: AccountFlowMode,
  result: AccountFlowState = { status: "sent", message: "Check your inbox" },
) {
  const action = vi.fn<AccountFlowAction>().mockResolvedValue(result);
  render(
    <AccountFlowPresentation
      mode={mode}
      action={action}
      signInHref="/login"
      requestCodeHref="/login?mode=recover"
      enterCodeHref="/login?mode=update-password"
    />,
  );
  return action;
}
function fill(mode: AccountFlowMode) {
  fireEvent.change(screen.getByLabelText("Work email"), {
    target: { value: "synthetic@example.test" },
  });
  if (mode === "create") {
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Synthetic User" },
    });
    fireEvent.change(screen.getByLabelText("Account type"), {
      target: { value: "agency" },
    });
  }
  if (mode !== "recover")
    fireEvent.change(
      screen.getByLabelText(mode === "create" ? "Password" : "New password"),
      { target: { value: "synthetic-password" } },
    );
  if (mode === "update-password")
    fireEvent.change(screen.getByLabelText("Recovery code"), {
      target: { value: "123456" },
    });
  fireEvent.click(screen.getByRole("button"));
}
describe("account flow presentation", () => {
  it("uses real profile fields without fictitious legal links or access claims", async () => {
    const action = setup("create");
    expect(screen.getByLabelText("Full name")).toBeRequired();
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(screen.getByText(/does not grant access/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fill("create");
    await waitFor(() =>
      expect(screen.getByText("Check your inbox")).toHaveFocus(),
    );
    expect(action.mock.calls[0][1].get("accountType")).toBe("agency");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("retains profile inputs after an unconfirmed request and focuses its message", async () => {
    setup("create", {
      status: "error",
      message: "Could not confirm the request",
    });
    fill("create");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
    expect(screen.getByLabelText("Work email")).toHaveValue(
      "synthetic@example.test",
    );
    expect(screen.getByLabelText("Full name")).toHaveValue("Synthetic User");
    expect(screen.getByLabelText("Account type")).toHaveValue("agency");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByRole("button")).toBeEnabled();
  });
  it("links a sent recovery request to code entry without putting the email in the URL", async () => {
    setup("recover");
    fill("recover");
    expect(
      await screen.findByRole("link", { name: "Enter recovery code" }),
    ).toHaveAttribute("href", "/login?mode=update-password");
  });
  it("removes the consumed-code form after ambiguous update and requires a fresh code", async () => {
    setup("update-password", {
      status: "restart",
      message: "Outcome unconfirmed; request a fresh code",
    });
    expect(screen.getByLabelText("Recovery code")).toHaveAttribute(
      "autocomplete",
      "one-time-code",
    );
    fill("update-password");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
    expect(screen.queryByLabelText("Recovery code")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Request a fresh code" }),
    ).toHaveAttribute("href", "/login?mode=recover");
  });
  it("returns confirmed password updates to normal sign-in", async () => {
    setup("update-password", {
      status: "complete",
      message: "Password updated",
    });
    fill("update-password");
    await waitFor(() =>
      expect(screen.getByText("Password updated")).toHaveFocus(),
    );
    expect(
      screen.getByRole("link", { name: "Back to sign-in" }),
    ).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

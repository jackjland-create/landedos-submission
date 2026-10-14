import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignInPresentation } from "./sign-in-presentation";
afterEach(cleanup);

function setup(extra = {}) {
  const props = {
    loginAction: vi
      .fn<(form: FormData) => Promise<void>>()
      .mockResolvedValue(undefined),
    requestAccessAction: vi
      .fn<(form: FormData) => Promise<void>>()
      .mockResolvedValue(undefined),
    returnPath: "/projects/helios/overview",
    isReturning: false,
    ...extra,
  };
  render(<SignInPresentation {...props} />);
  return props;
}

describe("sign-in presentation", () => {
  it("uses one labelled native form with existing credential semantics", () => {
    setup();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByLabelText("Work email")).toHaveAttribute(
      "autocomplete",
      "email",
    );
    expect(screen.getByLabelText("Work email")).toBeRequired();
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "minlength",
      "10",
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Request access" }),
    ).toBeEnabled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("reveals a password without submitting or changing its value", () => {
    const props = setup();
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "synthetic-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Password")).toHaveValue("synthetic-password");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "type",
      "password",
    );
    expect(props.loginAction).not.toHaveBeenCalled();
    expect(props.requestAccessAction).not.toHaveBeenCalled();
  });

  it("focuses server errors and announces server messages without claiming success", () => {
    setup({
      error: "The credentials could not be verified",
      message: "Check your email",
    });
    expect(screen.getByRole("alert")).toHaveFocus();
    expect(screen.getByText("Check your email")).toHaveAttribute(
      "role",
      "status",
    );
  });

  it.each(["Sign in", "Request access"])(
    "submits %s to its supplied action and blocks duplicate submits only while pending",
    async (buttonName) => {
      let release!: () => void;
      const pendingAction = vi.fn<(form: FormData) => Promise<void>>(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      const props = setup(
        buttonName === "Sign in"
          ? { loginAction: pendingAction }
          : { requestAccessAction: pendingAction },
      );
      fireEvent.change(screen.getByLabelText("Work email"), {
        target: { value: "synthetic@example.test" },
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "synthetic-password" },
      });
      fireEvent.click(screen.getByRole("button", { name: buttonName }));
      await waitFor(() => expect(pendingAction).toHaveBeenCalledTimes(1));
      expect(
        screen.getByText("Your request is being processed."),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Signing in|^Sign in$/ }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", {
          name: /Requesting access|^Request access$/,
        }),
      ).toBeDisabled();
      expect(pendingAction.mock.calls[0][0].get("next")).toBe(props.returnPath);
      expect(pendingAction.mock.calls[0][0].get("email")).toBe(
        "synthetic@example.test",
      );
      await act(async () => release());
      expect(screen.getByRole("button", { name: buttonName })).toBeEnabled();
    },
  );
});

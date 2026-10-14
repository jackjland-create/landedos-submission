import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { workspaceFixture } from "@/lib/campaign-workspace.fixture";
import { CampaignBriefWorkflow } from "./campaign-brief-workflow";
import { campaignEditSavedEvent } from "./campaign-edit-guard";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const brief = workspaceFixture.briefVersions[0];
const props = {
  canManage: true,
  campaignId: workspaceFixture.id,
  projectId: workspaceFixture.projectId,
  versions: [brief],
};

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});
const open = () =>
  fireEvent.click(screen.getByRole("button", { name: "Edit brief" }));
function complete() {
  fireEvent.change(screen.getByLabelText("Audience"), {
    target: { value: "Solana product users" },
  });
  fireEvent.change(screen.getByLabelText("Key message"), {
    target: { value: "Test the product journey" },
  });
  fireEvent.change(screen.getByLabelText("Creator direction"), {
    target: { value: "Explain each step clearly" },
  });
}

it("shows the saved summary with a visible edit action and keeps inputs in a labelled dialog", () => {
  render(<CampaignBriefWorkflow {...props} theme="dark" />);
  expect(screen.getByRole("heading", { name: "Campaign brief" })).toBeVisible();
  expect(screen.getByText(brief.objective, { selector: "dd" })).toBeVisible();
  expect(screen.getAllByText("Not defined")).toHaveLength(3);
  expect(screen.queryByRole("dialog")).toBeNull();
  open();
  const modal = screen.getByRole("dialog", { name: "Edit campaign brief" });
  expect(modal).toHaveAccessibleDescription(
    /Saving creates a new brief version/,
  );
  expect(modal.closest("[data-theme]")).toHaveAttribute("data-theme", "dark");
  expect(
    screen.getByRole("heading", { name: "Edit campaign brief" }),
  ).toHaveFocus();
  for (const label of [
    "Objective",
    "Audience",
    "Key message",
    "Creator direction",
    "Change reason",
  ]) {
    const field = screen.getByLabelText(label);
    expect(field).toBeRequired();
    expect(
      field.closest("label")?.querySelector(".required-field-marker"),
    ).toHaveAttribute("aria-hidden", "true");
  }
  expect(screen.getByLabelText("Compliance notes")).not.toBeRequired();
  expect(
    screen
      .getByLabelText("Compliance notes")
      .closest("label")
      ?.querySelector(".required-field-marker"),
  ).toBeNull();
});

it("retains unsaved input across close and Escape without requests and returns focus", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(<CampaignBriefWorkflow {...props} />);
  open();
  fireEvent.change(screen.getByLabelText("Audience"), {
    target: { value: "Unsaved audience" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Back to brief" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Edit brief" })).toHaveFocus();
  open();
  expect(screen.getByLabelText("Audience")).toHaveValue("Unsaved audience");
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Edit brief" })).toHaveFocus();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("keeps native required validation and creates no request for an incomplete brief", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(<CampaignBriefWorkflow {...props} />);
  open();
  fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
  expect(screen.getByLabelText("Audience")).toBeInvalid();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeVisible();
});

it("saves the unchanged payload shape, closes on success and announces a retained version", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  const saved = vi.fn();
  document.addEventListener(campaignEditSavedEvent, saved);
  const view = render(<CampaignBriefWorkflow {...props} />);
  open();
  complete();
  fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("status")).toHaveTextContent(
    "Brief saved as a new version.",
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Edit brief" })).toHaveFocus(),
  );
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(saved).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    action: "save",
    objective: brief.objective,
    audience: "Solana product users",
    keyMessage: "Test the product journey",
    creatorDirection: "Explain each step clearly",
    complianceNotes: null,
    reason: "Complete campaign brief details",
    requestId: expect.any(String),
  });
  view.rerender(
    <CampaignBriefWorkflow
      {...props}
      versions={[
        { ...brief, version: 2, audience: "Solana product users" },
        brief,
      ]}
    />,
  );
  expect(
    screen.getByText("Solana product users", { selector: "dd" }),
  ).toBeVisible();
  expect(screen.getByText("View 2 retained brief versions")).toBeVisible();
  document.removeEventListener(campaignEditSavedEvent, saved);
});

it("keeps the editor open on server failure and blocks Escape while a save is pending", async () => {
  let resolve!: (value: unknown) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    ),
  );
  render(<CampaignBriefWorkflow {...props} />);
  open();
  complete();
  fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Close brief editor" }),
  ).toBeDisabled();
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  resolve({
    ok: false,
    json: async () => ({ message: "Please retry the save." }),
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Please retry the save.",
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByLabelText("Audience")).toHaveValue("Solana product users");
});

it.each(["draft", "revision_requested", "submitted", "approved"] as const)(
  "preserves manager edit availability for %s",
  (status) => {
    const view = render(
      <CampaignBriefWorkflow {...props} versions={[{ ...brief, status }]} />,
    );
    if (["draft", "revision_requested"].includes(status))
      expect(screen.getByRole("button", { name: "Edit brief" })).toBeVisible();
    else
      expect(screen.queryByRole("button", { name: "Edit brief" })).toBeNull();
    view.rerender(
      <CampaignBriefWorkflow
        {...props}
        versions={[{ ...brief, status }]}
        canManage={false}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(
      screen.getByText(/Campaign manager access is required/),
    ).toBeVisible();
  },
);

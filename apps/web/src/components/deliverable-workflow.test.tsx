import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { workspaceFixture } from "@/lib/campaign-workspace.fixture";
import { DeliverableWorkflow } from "./deliverable-workflow";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const asset = workspaceFixture.contentAssets[0];
const props = {
  asset,
  canManage: true,
  campaignId: workspaceFixture.id,
  campaignStatus: "approved" as const,
  projectId: workspaceFixture.projectId,
  presentation: "dialog" as const,
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
function open() {
  fireEvent.click(screen.getByRole("button", { name: "Update delivery" }));
}
function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save delivery" }));
}

it("exposes an action beside the asset and opens a labelled, theme-aware editor", () => {
  render(<DeliverableWorkflow {...props} theme="dark" />);
  const trigger = screen.getByRole("button", { name: "Update delivery" });
  expect(trigger).toBeVisible();
  expect(trigger.closest("[data-theme]")).toHaveAttribute("data-theme", "dark");
  expect(screen.queryByRole("dialog")).toBeNull();
  open();
  expect(
    screen.getByRole("dialog", { name: "Update delivery" }),
  ).toHaveAttribute("aria-describedby");
  expect(
    screen.getByRole("heading", { name: "Update delivery" }),
  ).toHaveFocus();
  expect(screen.getByLabelText("Next state")).toHaveValue("draft");
  expect(screen.getByLabelText("Content URL (optional)")).not.toBeRequired();
});

it("preserves local input on closing and returns focus to the trigger", async () => {
  render(<DeliverableWorkflow {...props} />);
  open();
  fireEvent.change(screen.getByLabelText("Review note"), {
    target: { value: "Retained local draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Back to delivery" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Update delivery" }),
    ).toHaveFocus(),
  );
  open();
  expect(screen.getByLabelText("Review note")).toHaveValue(
    "Retained local draft",
  );
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});

it.each(["draft", "approved"] as const)(
  "requires a content URL for %s's next state",
  (status) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<DeliverableWorkflow {...props} asset={{ ...asset, status }} />);
    open();
    expect(screen.getByLabelText("Content URL (required)")).toBeRequired();
    save();
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

it("retains input and retry identity on failure, then closes and refreshes after saving", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  render(<DeliverableWorkflow {...props} />);
  open();
  save();
  expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
  expect(screen.getByRole("dialog")).toBeVisible();
  save();
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  const first = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(first).toMatchObject({
    targetStatus: "draft",
    evidenceUrl: null,
    note: "Update deliverable review state",
  });
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).requestId).toBe(
    first.requestId,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("Delivery updated");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Update delivery" }),
    ).toHaveFocus(),
  );
});

it("keeps a pending update open, prevents duplicates and shows server errors", async () => {
  let resolve!: (value: unknown) => void;
  const fetchMock = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<DeliverableWorkflow {...props} />);
  open();
  save();
  expect(screen.getByRole("button", { name: "Recording…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Close delivery" })).toBeDisabled();
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent.submit(screen.getByLabelText("Next state").closest("form")!);
  expect(fetchMock).toHaveBeenCalledOnce();
  resolve({
    ok: false,
    json: async () => ({ message: "This state is no longer available." }),
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This state is no longer available.",
  );
});

it.each([
  { canManage: false, campaignStatus: "approved" as const, asset },
  { canManage: true, campaignStatus: "finalized" as const, asset },
  {
    canManage: true,
    campaignStatus: "approved" as const,
    asset: { ...asset, status: "published" as const },
  },
])(
  "preserves read-only availability and history for $campaignStatus / $canManage",
  (overrides) => {
    render(<DeliverableWorkflow {...props} {...overrides} />);
    expect(
      screen.queryByRole("button", { name: "Update delivery" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View delivery" }));
    expect(
      screen.getByRole("heading", { name: "Delivery history" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save delivery" })).toBeNull();
    expect(screen.queryByLabelText("Next state")).toBeNull();
    fireEvent.click(screen.getByText("Delivery history (0)"));
    expect(screen.getByText("No delivery changes recorded yet.")).toBeVisible();
  },
);

it("uses the next allowed state after the saved asset refreshes", () => {
  const { rerender } = render(<DeliverableWorkflow {...props} />);
  rerender(
    <DeliverableWorkflow {...props} asset={{ ...asset, status: "draft" }} />,
  );
  open();
  expect(screen.getByLabelText("Next state")).toHaveValue("submitted");
});

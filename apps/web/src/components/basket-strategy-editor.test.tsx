import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  draftCustomBasket,
  draftFromPreparedBasket,
  getPreparedBasket,
  type SavedBasketStrategy,
} from "@landed/contracts";
import {
  StrategyEditorSession,
  BasketStrategyEditor,
} from "./basket-strategy-editor";
import { retainStrategyDraft } from "@/lib/baskets/strategy-recovery";
import { StrategyClientError } from "@/lib/baskets/strategy-client";

const id = "90000000-0000-4000-8000-000000000001",
  owner = "91000000-0000-4000-8000-000000000001";
let identity: (
  _event: string,
  session: { user: { id: string } } | null,
) => void;
const getUser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser,
      onAuthStateChange: (cb: typeof identity) => {
        identity = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  }),
}));
beforeEach(() => {
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null }, error: null });
});
function setup() {
  const record: SavedBasketStrategy = {
    basketId: id,
    revision: 4,
    persistence: "saved",
    draft: draftFromPreparedBasket(getPreparedBasket("investor_reach", 1)!),
  };
  const client = {
    load: vi.fn().mockResolvedValue(record),
    save: vi.fn().mockResolvedValue(5),
    addCreators: vi.fn(),
  };
  const review = vi.fn();
  const props = {
    projectId: "helios",
    basketId: id,
    ownerId: owner,
    canManage: true,
    onReviewState: review,
    client,
  };
  return { record, client, review, props };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  retainStrategyDraft(owner, "helios", id, null);
});
describe("BSK-08 rendered strategy editor", () => {
  it("adds blank channel fields with examples and selects text without changing it", async () => {
    const { props, record, client } = setup();
    record.draft = draftCustomBasket({ name: "Internal test" });
    render(<StrategyEditorSession {...props} section="purpose" />);
    const name = await screen.findByLabelText("Plan name");
    await waitFor(() => expect(name).toBeEnabled());
    fireEvent.focus(name);
    expect(name).toHaveValue("Internal test");
    expect((name as HTMLInputElement).selectionStart).toBe(0);
    expect((name as HTMLInputElement).selectionEnd).toBe(
      "Internal test".length,
    );
    fireEvent.click(screen.getByText(/Planned channel mix/));
    fireEvent.click(screen.getByRole("button", { name: "Add a channel" }));
    expect(screen.getByLabelText("Format")).toHaveValue("");
    expect(screen.getByLabelText("Format")).toHaveAttribute(
      "placeholder",
      "e.g. Thread",
    );
    const share = screen.getByLabelText("Spend share (%)");
    expect(share).toHaveValue("");
    for (const value of ["0", "0.", "0.5", "0.01", "100"]) {
      fireEvent.change(share, { target: { value } });
      expect(share).toHaveValue(value);
    }
    expect(client.save).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    "notifies the host only for confirmed saves (success=%s)",
    async (success) => {
      const { props, client } = setup();
      const onSaved = vi.fn();
      if (!success)
        client.save.mockRejectedValue(new StrategyClientError("unavailable"));
      render(
        <StrategyEditorSession
          {...props}
          section="purpose"
          onSaved={onSaved}
        />,
      );
      const name = await screen.findByLabelText("Plan name");
      await waitFor(() => expect(name).toBeEnabled());
      fireEvent.change(name, { target: { value: "Updated test plan" } });
      fireEvent.click(screen.getByRole("button", { name: "Save strategy" }));
      if (success) {
        await waitFor(() =>
          expect(onSaved).toHaveBeenCalledExactlyOnceWith("purpose"),
        );
      } else {
        await screen.findByRole("button", { name: "Check saved strategy" });
        expect(onSaved).not.toHaveBeenCalled();
        expect(name).toHaveValue("Updated test plan");
      }
    },
  );
  it("reports invalid shared goal fields while the measurement section is open", async () => {
    const { props, client } = setup();
    const view = render(<StrategyEditorSession {...props} section="purpose" />);
    const name = await screen.findByLabelText("Plan name");
    await waitFor(() => expect(name).toBeEnabled());
    fireEvent.change(name, { target: { value: "" } });
    view.rerender(<StrategyEditorSession {...props} section="measurement" />);
    const save = screen.getByRole("button", { name: "Save strategy" });
    expect(save.closest("form")).toHaveAttribute("novalidate");
    fireEvent.click(save);
    await waitFor(() =>
      expect(
        screen
          .getByText("Check these strategy details:")
          .closest('[role="alert"]'),
      ).toHaveFocus(),
    );
    expect(client.save).not.toHaveBeenCalled();
  });
  it("exposes the private-test rationale before approval without blocking unfinished draft saves", async () => {
    const { props, record, client } = setup();
    record.draft = draftCustomBasket({ name: "Private test" });
    record.draft.strategy.distributionMode = "unpaid_private_link";
    render(<StrategyEditorSession {...props} allowPrivateLinkTest />);
    const reason = await screen.findByLabelText(
      "Why this private test? (required before approval)",
      undefined,
      { timeout: 5_000 },
    );
    expect(reason.closest("details")).toBeNull();
    expect(reason).not.toHaveAttribute("required");
    expect(reason).toHaveAttribute("aria-required", "true");
    expect(reason).toHaveAccessibleDescription(
      /add this reason before reviewing/,
    );
    fireEvent.change(reason, {
      target: {
        value:
          "Validate the private consent-to-report path without compensation.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save strategy" }));
    await screen.findByText("Strategy saved", undefined, { timeout: 5_000 });
    expect(client.save.mock.calls[0][0].strategy.rationale).toBe(
      "Validate the private consent-to-report path without compensation.",
    );
  });
  const choice = {
    id: "92000000-0000-4000-8000-000000000001",
    name: "First qualifying transaction",
    description: "A verified first qualifying transaction with consent.",
    version: 1,
    effectiveFrom: "2026-09-01T00:00:00Z",
    effectiveUntil: null,
    supported: true,
  };
  it("explicitly selects and saves a definition without changing other strategy fields", async () => {
    const { props, record, client, review } = setup();
    record.draft.strategy.measurement = null;
    render(
      <StrategyEditorSession
        {...props}
        theme="dark"
        measurementChoices={{ kind: "ready", options: [choice] }}
      />,
    );
    const radio = await screen.findByRole("radio", {
      name: /First qualifying transaction/,
    });
    await waitFor(() => expect(radio).toBeEnabled());
    fireEvent.click(screen.getByText("Need a different rule?"));
    expect(
      screen.getByRole("link", { name: "Create a new success rule version" }),
    ).toHaveAttribute(
      "href",
      `/projects/${props.projectId}/settings/conversions?plan=${encodeURIComponent(props.basketId)}&theme=dark#create-rule`,
    );
    expect(radio).not.toBeChecked();
    expect(
      screen.getByText(
        "No rule chosen yet. Pick the one that decides what counts.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(radio);
    expect(radio).toBeChecked();
    fireEvent.click(screen.getByText("Rule details and limits"));
    expect(
      screen.getByRole("heading", {
        name: "First qualifying transaction · version 1",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "How this rule measures" }),
    ).toHaveTextContent("Signing alone isn’t a result.");
    expect(review.mock.lastCall?.[0].blocked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save strategy" }));
    await screen.findByText("Strategy saved");
    expect(client.save.mock.calls[0][0].strategy).toEqual({
      ...record.draft.strategy,
      measurement: {
        primaryOutcome: "qualified_wallets",
        qualifyingAction: choice.name,
        conversionRuleVersionId: choice.id,
        attributionModel: "last_eligible_touch",
        attributionWindowDays: 7,
        leadingIndicators: [],
        retentionWindowDays: null,
        revenueTreatment: "verified_protocol_revenue_only",
      },
    });
  });
  it("requires confirmation to replace a proposal and retains its supporting assumptions", async () => {
    const { props, record, client } = setup();
    const old = record.draft.strategy.measurement!;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <StrategyEditorSession
        {...props}
        measurementChoices={{ kind: "ready", options: [choice] }}
      />,
    );
    const radio = await screen.findByRole("radio", {
      name: /First qualifying transaction/,
    });
    await waitFor(() => expect(radio).toBeEnabled());
    fireEvent.click(radio);
    expect(radio).not.toBeChecked();
    expect(client.save).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(radio);
    expect(radio).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save strategy" }));
    await screen.findByText("Strategy saved");
    expect(client.save.mock.calls[0][0].strategy.measurement).toMatchObject({
      conversionRuleVersionId: choice.id,
      leadingIndicators: old.leadingIndicators,
      retentionWindowDays: old.retentionWindowDays,
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear rule choice" }));
    expect(confirm).toHaveBeenLastCalledWith(
      expect.stringContaining("Remove this plan's rule choice?"),
    );
    expect(radio).not.toBeChecked();
  });
  it.each(["unavailable", "empty", "unsupported"])(
    "retains a missing saved binding when choices are %s",
    async (state) => {
      const { props, record, client } = setup();
      record.draft.strategy.measurement!.conversionRuleVersionId = choice.id;
      render(
        <StrategyEditorSession
          {...props}
          measurementChoices={
            state === "unavailable"
              ? { kind: "unavailable" }
              : {
                  kind: "ready",
                  options:
                    state === "empty" ? [] : [{ ...choice, supported: false }],
                }
          }
        />,
      );
      const saved = await screen.findByRole("radio", { checked: true });
      expect(saved).toBeDisabled();
      expect(saved).toHaveAttribute("value", choice.id);
      expect(
        screen.queryByRole("button", { name: "Clear rule choice" }),
      ).toBeNull();
      expect(client.save).not.toHaveBeenCalled();
    },
  );
  it("saves goal edits while preserving measurement, sources and allocation", async () => {
    const { client, record, review, props } = setup();
    render(<StrategyEditorSession {...props} />);
    const goal = await screen.findByLabelText("Goal");
    await waitFor(() => expect(goal).toBeEnabled());
    fireEvent.change(goal, {
      target: { value: "Reach qualified institutional investors" },
    });
    expect(screen.getByText("Unsaved strategy changes")).toBeVisible();
    expect(review.mock.lastCall?.[0].blocked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save strategy" }));
    await screen.findByText("Strategy saved");
    expect(client.save).toHaveBeenCalledWith({
      expectedRevision: 4,
      name: record.draft.name,
      strategy: {
        ...record.draft.strategy,
        goal: "Reach qualified institutional investors",
      },
    });
    await waitFor(() =>
      expect(review.mock.lastCall?.[0]).toMatchObject({
        blocked: false,
        revision: 5,
      }),
    );
  });
  it("requires confirmation before replacing planned spend with a private devnet link", async () => {
    const { props, record, client } = setup();
    record.draft = draftCustomBasket({ name: "Internal proof" });
    record.draft.strategy.allocations = getPreparedBasket(
      "investor_reach",
      1,
    )!.strategy.allocations;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<StrategyEditorSession {...props} allowPrivateLinkTest />);
    const selector = await screen.findByLabelText(
      "How will this test be shared?",
    );
    await waitFor(() => expect(selector).toBeEnabled());
    fireEvent.change(selector, { target: { value: "unpaid_private_link" } });
    expect(screen.getByText(/Planned channel mix/)).toBeVisible();
    confirm.mockReturnValue(true);
    fireEvent.change(selector, { target: { value: "unpaid_private_link" } });
    expect(
      screen.getByText(/No public post, planned channel spend/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save strategy" }));
    await screen.findByText("Strategy saved");
    expect(client.save.mock.calls[0][0].strategy).toMatchObject({
      distributionMode: "unpaid_private_link",
      allocations: [],
    });
  });
  it("recovers unsaved edits on return without automatically saving", async () => {
    const { client, props } = setup();
    const first = render(<StrategyEditorSession {...props} />);
    const goal = await screen.findByLabelText("Goal");
    await waitFor(() => expect(goal).toBeEnabled());
    fireEvent.change(goal, { target: { value: "Retained local goal" } });
    first.unmount();
    render(<StrategyEditorSession {...props} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Restore unsaved strategy" }),
    );
    expect(screen.getByLabelText("Goal")).toHaveValue("Retained local goal");
    expect(client.save).not.toHaveBeenCalled();
  });
  it("requires saved-version comparison when recovery has an older revision", async () => {
    const { props, record } = setup();
    retainStrategyDraft(owner, "helios", id, {
      revision: 3,
      edits: {
        name: record.draft.name,
        strategy: { ...record.draft.strategy, goal: "Older local goal" },
      },
      uncertain: false,
    });
    render(<StrategyEditorSession {...props} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Restore unsaved strategy" }),
    );
    expect(
      screen.getByRole("button", { name: "Save strategy" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Check saved strategy" }),
    );
    await screen.findByRole("region", { name: "Compare saved strategy" });
    expect(screen.getByLabelText("Goal")).toHaveValue("Older local goal");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Discard my edits and use saved strategy",
      }),
    );
    expect(screen.getByLabelText("Goal")).toHaveValue(
      record.draft.strategy.goal,
    );
  });
  it("retains uncertain edits without automatic retry", async () => {
    const { props, client } = setup();
    client.save.mockRejectedValue(new StrategyClientError("unavailable"));
    render(<StrategyEditorSession {...props} />);
    const goal = await screen.findByLabelText("Goal");
    await waitFor(() => expect(goal).toBeEnabled());
    fireEvent.change(goal, { target: { value: "Keep this goal" } });
    fireEvent.click(screen.getByRole("button", { name: "Save strategy" }));
    await screen.findByText(/could not confirm the result/);
    expect(screen.getByLabelText("Goal")).toHaveValue("Keep this goal");
    expect(
      screen.getByRole("button", { name: "Save strategy" }),
    ).toBeDisabled();
    expect(client.save).toHaveBeenCalledTimes(1);
  });
  it("shows specific invalid fields before any write", async () => {
    const { props, client } = setup();
    render(<StrategyEditorSession {...props} />);
    const goal = await screen.findByLabelText("Goal");
    await waitFor(() => expect(goal).toBeEnabled());
    fireEvent.change(goal, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save strategy" }));
    expect(await screen.findByText(/goal:/)).toBeVisible();
    expect(client.save).not.toHaveBeenCalled();
  });
  it("does not reveal recovery after switching identities", async () => {
    const { props } = setup();
    getUser.mockResolvedValue({
      data: { user: { id: owner } },
      error: null,
    });
    render(<BasketStrategyEditor {...props} />);
    expect(screen.queryByLabelText("Goal")).not.toBeInTheDocument();
    await act(async () => identity("INITIAL_SESSION", { user: { id: owner } }));
    const goal = await screen.findByLabelText("Goal");
    await waitFor(() => expect(goal).toBeEnabled());
    fireEvent.change(goal, { target: { value: "Private local goal" } });
    await act(async () => identity("SIGNED_OUT", null));
    expect(
      screen.queryByDisplayValue("Private local goal"),
    ).not.toBeInTheDocument();
  });
  it("recovers a failed first session check only after fresh verification", async () => {
    const { props, client, review } = setup();
    getUser
      .mockRejectedValueOnce(new Error("temporary auth read failure"))
      .mockResolvedValueOnce({ data: { user: { id: owner } }, error: null });
    render(<BasketStrategyEditor {...props} />);
    const retry = await screen.findByRole("button", {
      name: "Check session again",
    });
    expect(screen.queryByLabelText("Goal")).not.toBeInTheDocument();
    expect(client.load).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute(
      "href",
      `/login?next=%2Fprojects%2Fhelios%2Fbaskets%2F${id}`,
    );
    expect(review.mock.lastCall?.[0]).toMatchObject({ blocked: true });
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByLabelText("Goal")).toBeEnabled());
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(client.load).toHaveBeenCalledTimes(1);
  });
  it("does not trust an initial cached session for a different basket owner", async () => {
    const { props, client } = setup();
    getUser.mockResolvedValue({
      data: { user: { id: "91000000-0000-4000-8000-000000000002" } },
      error: null,
    });
    render(<BasketStrategyEditor {...props} />);
    await act(async () => identity("INITIAL_SESSION", { user: { id: owner } }));
    await screen.findByText(/belongs to another account/);
    expect(screen.queryByLabelText("Goal")).not.toBeInTheDocument();
    expect(client.load).not.toHaveBeenCalled();
  });
  it("ignores a late owner lookup after sign-out", async () => {
    const { props, client } = setup();
    let resolveLookup: (value: unknown) => void = () => {};
    getUser.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLookup = resolve;
        }),
    );
    render(<BasketStrategyEditor {...props} />);
    await waitFor(() => expect(getUser).toHaveBeenCalledTimes(1));
    await act(async () => identity("SIGNED_OUT", null));
    await act(async () => {
      resolveLookup({ data: { user: { id: owner } }, error: null });
    });
    expect(screen.getByText(/Your session has ended/)).toBeVisible();
    expect(screen.queryByLabelText("Goal")).not.toBeInTheDocument();
    expect(client.load).not.toHaveBeenCalled();
  });
  it("confirms an already signed-in owner without waiting for an auth event", async () => {
    const { props, client } = setup();
    getUser.mockResolvedValue({
      data: { user: { id: owner } },
      error: null,
    });
    render(
      <StrictMode>
        <BasketStrategyEditor {...props} />
      </StrictMode>,
    );
    const goal = await screen.findByLabelText("Goal");
    await waitFor(() => expect(goal).toBeEnabled());
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(client.load).toHaveBeenCalledTimes(1);
  });
  it("does not let an empty initial-session event mask the verified owner", async () => {
    const { props } = setup();
    let finish!: (value: unknown) => void;
    getUser.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<BasketStrategyEditor {...props} />);
    await act(async () => identity("INITIAL_SESSION", null));
    await act(async () =>
      finish({ data: { user: { id: owner } }, error: null }),
    );
    await waitFor(() => expect(screen.getByLabelText("Goal")).toBeEnabled());
    await act(async () => identity("SIGNED_OUT", null));
    expect(screen.queryByLabelText("Goal")).not.toBeInTheDocument();
  });
  it("renders permission and unavailable states without editable controls", async () => {
    const { props, client } = setup();
    const first = render(
      <StrategyEditorSession {...props} canManage={false} />,
    );
    expect(await screen.findByLabelText("Goal")).toBeDisabled();
    first.unmount();
    client.load.mockRejectedValue(new StrategyClientError("permission"));
    render(<StrategyEditorSession {...props} />);
    await screen.findByText(/do not have access/);
    expect(screen.queryByLabelText("Goal")).not.toBeInTheDocument();
  });
});

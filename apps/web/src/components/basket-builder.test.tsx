import type { BasketRecord } from "@landed/contracts";
import {
  draftCustomBasket,
  draftFromPreparedBasket,
  getPreparedBasket,
} from "@landed/contracts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BasketBuilder,
  BasketBuilderPermission,
  OutcomeSetup,
  outcomeValueMessages,
  parseOutcomeValue,
} from "./basket-builder";
import { captureHandoff } from "@/test/capture-handoff";
import { captureTimingEvidence } from "@/test/capture-timing";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const { authListeners, getUser } = vi.hoisted(() => ({
  authListeners: new Set<
    (event: string, session: { user: { id: string } } | null) => void
  >(),
  getUser: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser,
      onAuthStateChange: (
        callback: (
          event: string,
          session: { user: { id: string } } | null,
        ) => void,
      ) => {
        authListeners.add(callback);
        return {
          data: {
            subscription: { unsubscribe: () => authListeners.delete(callback) },
          },
        };
      },
    },
  }),
}));

const basket: BasketRecord = {
  id: "90000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000001",
  projectId: "20000000-0000-4000-8000-000000000001",
  name: "Helios Mobile roster",
  objective: null,
  outcomeProfile: null,
  createdAt: "2026-07-30T12:00:00.000Z",
  updatedAt: "2026-07-30T12:00:00.000Z",
  latestApproval: null,
  latestApprovalIsCurrent: null,
  scenarios: [
    {
      id: "91000000-0000-4000-8000-000000000001",
      code: "A",
      name: "Focused authority",
      packageIds: ["92000000-0000-4000-8000-000000000001"],
    },
    {
      id: "91000000-0000-4000-8000-000000000002",
      code: "B",
      name: "Broad reach",
      packageIds: ["92000000-0000-4000-8000-000000000001"],
    },
    {
      id: "91000000-0000-4000-8000-000000000003",
      code: "C",
      name: "Proof first",
      packageIds: ["92000000-0000-4000-8000-000000000001"],
    },
  ],
  packages: [
    {
      id: "92000000-0000-4000-8000-000000000001",
      creatorId: "40000000-0000-4000-8000-000000000001",
      creatorName: "Maya / Chain Mode",
      creatorHandle: "@chainmode",
      audience: {
        channelType: "x",
        size: 142000,
        observedAt: "2026-07-01T12:00:00.000Z",
        sourceLabel: "Seeded demonstration evidence",
      },
      packageLabel: "Launch package",
      deliverableSummary: "One X thread and one short-form video",
      sourceRateQuoteId: "80000000-0000-4000-8000-000000000001",
      compensationLines: [],
    },
  ],
};

beforeEach(() => {
  getUser.mockResolvedValue({ data: { user: null }, error: null });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  authListeners.clear();
  getUser.mockReset();
  vi.unstubAllGlobals();
});

const packageId = basket.packages[0]!.id;

const fixedCashLine = {
  id: "93000000-0000-4000-8000-000000000001",
  assetType: "cash" as const,
  model: "fixed" as const,
  variableUnit: null,
  amountMinor: "460000",
  currencyCode: "GBP" as const,
  createdAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
};

const readyBasket: BasketRecord = {
  ...basket,
  objective: "Increase qualified wallets",
  outcomeProfile: {
    baselineUnits: "50",
    currencyCode: null,
    metric: "qualified_wallets",
    targetUnits: "150",
  },
  packages: [{ ...basket.packages[0]!, compensationLines: [fixedCashLine] }],
};

function stepsCard() {
  return screen.getByRole("region", { name: /steps to approval|Plan details/ });
}

function stepItem(title: string) {
  return within(stepsCard())
    .getByRole("heading", { name: new RegExp(`${title}$`) })
    .closest("li")!;
}

function drawer(name?: string | RegExp) {
  return name
    ? screen.getByRole("dialog", { name })
    : screen.getByRole("dialog");
}

function openTerms(name = "Add terms for Maya / Chain Mode") {
  fireEvent.click(screen.getByRole("button", { name }));
  expect(drawer(/Terms for/)).toHaveAttribute("data-presentation", "dialog");
  return drawer(/Terms for/);
}

describe("BasketBuilder", () => {
  it("does not label unknown approval currentness as changed or currently approved", () => {
    window.history.replaceState(null, "", "/?step=terms");
    render(
      <BasketBuilder
        basket={{
          ...readyBasket,
          latestApprovalIsCurrent: null,
          latestApproval: {
            id: "94000000-0000-4000-8000-000000000001",
            scenarioId: basket.scenarios[0]!.id,
            scenarioCode: "A",
            scenarioName: "Focused authority",
            version: 1,
            approvedBy: basket.id,
            approvedAt: "2026-08-05T00:30:00.000Z",
            reason: "Retained plan",
            snapshotHash: "a".repeat(64),
          },
        }}
      />,
    );
    expect(drawer()).toHaveTextContent(
      "Read-only access to saved deliverables and compensation.",
    );
    expect(drawer()).not.toHaveTextContent(
      "differs from its previous approval",
    );
    expect(drawer()).not.toHaveTextContent("Approved terms · read only");
  });
  it("does not infer paid or unpaid basis from missing legacy terms", () => {
    render(<BasketBuilder canManage={false} basket={basket} />);
    fireEvent.click(within(stepItem("Creator terms")).getByRole("button"));
    const terms = screen.getByRole("region", { name: /Saved terms for/ });
    expect(terms).toHaveTextContent("Commercial basisNot specified");
    expect(terms).toHaveTextContent(
      "No compensation lines recorded. Cost is not confirmed.",
    );
    expect(terms).not.toHaveTextContent("Paid compensation");
    expect(terms).not.toHaveTextContent("Unpaid internal test");
  });
  it.each([true, false])(
    "keeps approved values read-only (manager=%s), with revision only for managers",
    async (manager) => {
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      render(
        <BasketBuilder
          canManage={manager}
          basket={{
            ...readyBasket,
            latestApprovalIsCurrent: true,
            latestApproval: {
              id: "94000000-0000-4000-8000-000000000001",
              scenarioId: basket.scenarios[0]!.id,
              scenarioCode: "A",
              scenarioName: "Focused authority",
              version: 1,
              approvedBy: basket.id,
              approvedAt: "2026-08-05T00:30:00.000Z",
              reason: "Approved exact plan",
              snapshotHash: "a".repeat(64),
            },
          }}
        />,
      );
      fireEvent.click(within(stepItem("Target")).getByRole("button"));
      expect(
        screen.getByRole("region", { name: "Campaign outcome" }),
      ).toHaveTextContent("150 wallets");
      expect(screen.queryByRole("button", { name: "Edit target" })).toBeNull();
      if (manager)
        expect(
          screen.getByRole("button", { name: "Edit as new draft" }),
        ).toBeEnabled();
      else
        expect(
          screen.queryByRole("button", { name: "Edit as new draft" }),
        ).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "Close and return to the plan" }),
      );
      fireEvent.click(within(stepItem("Creator terms")).getByRole("button"));
      const terms = screen.getByRole("region", {
        name: "Saved terms for Maya / Chain Mode",
      });
      expect(terms).toHaveTextContent("GBP 4600 · fixed");
      expect(terms).toHaveTextContent("One X thread and one short-form video");
      expect(terms.querySelector("input, select, textarea")).toBeNull();
      expect(drawer()).toHaveAttribute("data-presentation", "dialog");
      expect(drawer()).toHaveTextContent(
        "Approved terms · read only. Start a new plan to change them.",
      );
      const headings = within(terms).getAllByRole("heading", { level: 3 });
      expect(headings.map((heading) => heading.textContent)).toEqual([
        "Compensation terms",
        "Delivery and rights",
      ]);
      expect(drawer()).not.toHaveTextContent("Store the exact terms");
      expect(screen.queryByRole("button", { name: "Save terms" })).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("renders exact saved variable/token terms and missing values for a viewer without writes", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(
      <BasketBuilder
        canManage={false}
        basket={{
          ...readyBasket,
          packages: [
            {
              ...readyBasket.packages[0]!,
              packageLabel:
                "A long saved package label with every word retained",
              commercialDetailRevision: 1,
              commercialDetail: {
                schemaVersion: 1,
                channelIds: ["channel-1"],
                deliveryDeadline: "2026-10-20T12:34:56.123Z",
                usageRights: "First line\nSecond line of retained rights",
                exclusivity: null,
              },
              compensationLines: [
                {
                  id: fixedCashLine.id,
                  assetType: "token",
                  model: "variable",
                  variableUnit: "Qualified Wallet",
                  tokenMint: "MintEvidence",
                  tokenDecimals: 9,
                  tokenAmountRaw: "1234567890123456789",
                  unitPriceUsd: "0.125",
                  priceSource: "Saved source",
                  valuedAt: "2026-10-08T12:00:01.123Z",
                  createdAt: fixedCashLine.createdAt,
                  updatedAt: fixedCashLine.updatedAt,
                },
              ],
            },
          ],
        }}
      />,
    );
    fireEvent.click(within(stepItem("Creator terms")).getByRole("button"));
    const terms = screen.getByRole("region", { name: /Saved terms for/ });
    expect(terms).toHaveTextContent(
      "A long saved package label with every word retained",
    );
    expect(terms).toHaveTextContent(
      "Token 1234567890.123456789 · variable · per Qualified Wallet",
    );
    expect(terms).toHaveTextContent(
      "Saved source · valued 2026-10-08T12:00:01.123Z",
    );
    expect(terms).toHaveTextContent("2026-10-20T12:34:56.123Z");
    expect(terms).toHaveTextContent("Selected channel details unavailable");
    expect(terms).toHaveTextContent("ExclusivityNot specified");
    expect(terms).toHaveTextContent(
      "First line Second line of retained rights",
    );
    expect(terms.querySelector("input, select, textarea")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "keeps missing compensation separate from explicit unpaid terms (%s)",
    (unpaid) => {
      render(
        <BasketBuilder
          canManage={false}
          basket={{
            ...readyBasket,
            packages: [
              {
                ...readyBasket.packages[0]!,
                compensationLines: [],
                commercialDetailRevision: 1,
                commercialDetail: {
                  schemaVersion: 2,
                  commercialBasis: unpaid
                    ? "unpaid_internal_test"
                    : "compensated",
                  unpaidReason: unpaid ? "Approved internal test only" : null,
                  channelIds: [],
                  deliveryDeadline: null,
                  usageRights: null,
                  exclusivity: null,
                },
              },
            ],
          }}
        />,
      );
      fireEvent.click(within(stepItem("Creator terms")).getByRole("button"));
      const terms = screen.getByRole("region", { name: /Saved terms for/ });
      expect(terms).toHaveTextContent(
        unpaid
          ? "No compensation or payment commitment."
          : "No compensation lines recorded. Cost is not confirmed.",
      );
      if (unpaid)
        expect(terms).toHaveTextContent("Approved internal test only");
      expect(terms).not.toHaveTextContent("GBP 0");
    },
  );

  it("saves the shared strategy using the measurement dialog footer without approving", async () => {
    const draft = draftCustomBasket({ name: "Measurement setup" });
    const ruleId = "91000000-0000-4000-8000-000000000012";
    getUser.mockResolvedValue({
      data: { user: { id: basket.id } },
      error: null,
    });
    const fetcher = vi.fn(async (url: string, init?: RequestInit) =>
      Response.json(
        init?.method === "PUT"
          ? { revision: 2 }
          : url.endsWith("/strategy")
            ? { basketId: basket.id, revision: 1, persistence: "saved", draft }
            : {
                ownerId: basket.id,
                canManage: true,
                revision: 1,
                timing: null,
              },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    render(
      <BasketBuilder
        basket={basket}
        timingEnabled
        strategyOwnerId={basket.id}
        measurementChoices={{
          kind: "ready",
          options: [
            {
              id: ruleId,
              name: "Test result",
              description: "A consenting test result",
              version: 3,
              effectiveFrom: "2026-10-11T00:00:00Z",
              effectiveUntil: null,
              supported: true,
            },
          ],
        }}
      />,
    );
    await waitFor(() =>
      expect(stepItem("What counts as a result")).not.toHaveTextContent(
        "Checking",
      ),
    );
    fireEvent.click(
      within(stepItem("What counts as a result")).getByRole("button"),
    );
    const save = screen.getByRole("button", {
      name: "Save choice",
    }) as HTMLButtonElement;
    expect(save.closest("footer")).not.toBeNull();
    expect(save.form?.id).toBe(`basket-strategy-form-${basket.id}`);
    expect(save).toBeDisabled();
    const radio = await screen.findByRole("radio", { name: /Test result/ });
    await waitFor(() => expect(radio).toBeEnabled());
    fireEvent.click(radio);
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Choice saved")).toBeVisible();
    expect(new URL(window.location.href).searchParams.has("step")).toBe(false);
    const writes = fetcher.mock.calls.filter(
      ([, init]) => init?.method === "PUT",
    );
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0]![1]!.body))).toMatchObject({
      expectedOwnerId: basket.id,
      expectedRevision: 1,
      strategy: { measurement: { conversionRuleVersionId: ruleId } },
    });
    expect(fetcher.mock.calls.every(([url]) => !url.includes("approval"))).toBe(
      true,
    );
  });

  it("does not mark a revenue target done against a qualified-wallet rule", async () => {
    const draft = draftFromPreparedBasket(
      getPreparedBasket("investor_reach", 1)!,
    );
    const ruleId = "91000000-0000-4000-8000-000000000012";
    draft.strategy.measurement!.conversionRuleVersionId = ruleId;
    draft.strategy.measurement!.primaryOutcome = "qualified_wallets";
    getUser.mockResolvedValue({
      data: { user: { id: basket.id } },
      error: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.endsWith("/strategy")
                ? {
                    basketId: basket.id,
                    revision: 1,
                    persistence: "saved",
                    draft,
                  }
                : {
                    ownerId: basket.id,
                    canManage: true,
                    revision: 1,
                    timing: null,
                  },
            ),
          ),
      ),
    );
    render(
      <BasketBuilder
        basket={{
          ...readyBasket,
          outcomeProfile: {
            baselineUnits: "0",
            targetUnits: "10000",
            currencyCode: "GBP",
            metric: "verified_revenue",
          },
        }}
        timingEnabled
        strategyOwnerId={basket.id}
        measurementChoices={{
          kind: "ready",
          options: [
            {
              id: ruleId,
              name: "Wallet rule",
              description: "A qualified wallet result",
              version: 1,
              effectiveFrom: "2026-09-01T00:00:00Z",
              effectiveUntil: null,
              supported: true,
            },
          ],
        }}
      />,
    );
    await screen.findByText(/The target must match the selected rule/);
    expect(stepItem("Target")).not.toHaveTextContent("Done");
    expect(screen.queryByText("Ready to review")).toBeNull();
  });
  it("quarantines copied goals on identity loss without discarding outcome edits on ordinary strategy changes", async () => {
    const ownerId = "91000000-0000-4000-8000-000000000012";
    const goal = "Saved private goal for reuse";
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      expect(options?.method ?? "GET").toBe("GET");
      return new Response(
        JSON.stringify(
          url.endsWith("/strategy")
            ? {
                basketId: basket.id,
                revision: 3,
                persistence: "saved",
                draft: draftCustomBasket({ name: basket.name, goal }),
              }
            : { ownerId, canManage: true, revision: 3, timing: null },
        ),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    getUser.mockResolvedValue({
      data: { user: { id: ownerId } },
      error: null,
    });
    render(
      <BasketBuilder basket={basket} timingEnabled strategyOwnerId={ownerId} />,
    );
    expect(
      screen.queryByLabelText("Campaign objective"),
    ).not.toBeInTheDocument();
    const setTarget = within(stepItem("Target")).getByRole("button");
    await waitFor(() => expect(setTarget).toBeEnabled(), { timeout: 5_000 });
    fireEvent.click(setTarget);
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: "Use saved goal" },
        { timeout: 5_000 },
      ),
    );
    const objective = screen.getByLabelText("Campaign objective");
    expect(objective).toHaveValue(goal);
    fireEvent.change(screen.getByLabelText("Goal"), {
      target: { value: "Unsaved revised strategy" },
    });
    expect(screen.getByLabelText("Campaign objective")).toBe(objective);
    expect(objective).toHaveValue(goal);
    expect(
      screen.queryByRole("button", { name: "Use saved goal" }),
    ).not.toBeInTheDocument();
    await act(async () => {
      for (const callback of authListeners) callback("SIGNED_OUT", null);
    });
    expect(
      screen.queryByLabelText("Campaign objective"),
    ).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(goal)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /Confirming your account before showing the numerical target/,
      ),
    ).toBeVisible();
    expect(
      fetcher.mock.calls.every(
        ([, options]) =>
          !(options as RequestInit | undefined)?.method ||
          (options as RequestInit).method === "GET",
      ),
    ).toBe(true);
  });

  it("shows the five steps only behind the local strategy gate, each opening its real editor", async () => {
    const view = render(<BasketBuilder basket={basket} />);
    expect(
      within(stepsCard()).getAllByRole("heading", { level: 3 }),
    ).toHaveLength(2);
    expect(stepsCard()).toHaveAccessibleName("2 steps to approval");

    const ownerId = basket.id;
    getUser.mockResolvedValue({ data: { user: { id: ownerId } }, error: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.endsWith("/strategy")
                ? {
                    basketId: basket.id,
                    revision: 1,
                    persistence: "saved",
                    draft: draftCustomBasket({ name: basket.name }),
                  }
                : { ownerId, canManage: true, revision: 1, timing: null },
            ),
          ),
      ),
    );
    view.rerender(
      <BasketBuilder basket={basket} timingEnabled strategyOwnerId={ownerId} />,
    );
    expect(stepsCard()).toHaveAccessibleName("5 steps to approval");
    expect(
      within(stepsCard())
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent?.replace(/^Step \d+: /, "")),
    ).toEqual([
      "Goal and audience",
      "What counts as a result",
      "Target",
      "Dates",
      "Creator terms",
    ]);
    const chooseRule = within(stepItem("What counts as a result")).getByRole(
      "button",
    );
    await waitFor(() => expect(chooseRule).toBeEnabled(), { timeout: 5_000 });
    for (const [title, target] of [
      ["Goal and audience", "basket-strategy"],
      ["What counts as a result", "basket-measurement"],
      ["Target", "basket-outcome"],
      ["Dates", "basket-timing"],
    ] as const) {
      fireEvent.click(within(stepItem(title)).getByRole("button"));
      const panel = drawer(title);
      expect(panel).toBeVisible();
      const destination = view.container.querySelector(`#${target}`);
      expect(destination).not.toBeNull();
      expect(destination).toBeVisible();
      fireEvent.click(
        within(panel).getByRole("button", {
          name: "Close and return to the plan",
        }),
      );
    }
    expect(window.location.search).not.toContain("step=");
  });

  it("shows load failures as not available instead of steps to do", async () => {
    const ownerId = basket.id;
    getUser.mockResolvedValue({ data: { user: { id: ownerId } }, error: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "Unavailable." }), {
            status: 503,
          }),
      ),
    );
    render(
      <BasketBuilder basket={basket} timingEnabled strategyOwnerId={ownerId} />,
    );
    await waitFor(
      () =>
        expect(stepItem("Goal and audience")).toHaveTextContent(
          "Not available · We couldn’t load the saved strategy. Open to try again.",
        ),
      { timeout: 5_000 },
    );
    await waitFor(() =>
      expect(stepItem("Dates")).toHaveTextContent(
        "Not available · We couldn’t load the saved dates. Open to try again.",
      ),
    );
    expect(
      within(stepItem("Goal and audience")).getByRole("button", {
        name: "Open: Goal and audience",
      }),
    ).toBeEnabled();
    const note = screen.getByText(/steps left:/).parentElement!;
    expect(
      within(note).queryByRole("button", { name: /Goal and audience|Open/ }),
    ).toBeNull();
    expect(
      within(note).getByRole("button", { name: "Set target" }),
    ).toBeInTheDocument();
  });

  it("saves dates within the full local builder without enabling approval", async () => {
    const timing = {
      schemaVersion: 1,
      flight: {
        startedAt: "2026-09-14T09:00:00Z",
        endedAt: "2026-10-05T17:00:00Z",
      },
      measurement: {
        startedAt: "2026-09-14T00:00:00Z",
        endedAt: "2026-10-12T17:00:00Z",
      },
    };
    const identity = {
      ownerId: "91000000-0000-4000-8000-000000000012",
      canManage: true,
    };
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ...identity, revision: 3, timing })),
      );
    vi.stubGlobal("fetch", fetcher);
    const view = render(<BasketBuilder basket={basket} timingEnabled />);
    await screen.findByText("Saved dates loaded.");
    await waitFor(() =>
      expect(within(stepItem("Dates")).getByText("Done")).toBeInTheDocument(),
    );
    fireEvent.click(within(stepItem("Dates")).getByRole("button"));
    expect(
      screen.getByRole("region", { name: "Campaign date planning" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Approve selected terms" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Maya / Chain Mode").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Measurement ends (UTC)"), {
      target: { value: "2026-10-13T17:00" },
    });
    await waitFor(() =>
      expect(
        within(stepItem("Dates")).getByText("Editing now · unsaved"),
      ).toBeInTheDocument(),
    );
    fetcher
      .mockResolvedValueOnce(new Response(JSON.stringify({ revision: 4 })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...identity,
            revision: 4,
            timing: {
              ...timing,
              measurement: {
                ...timing.measurement,
                endedAt: "2026-10-13T17:00:00Z",
              },
            },
          }),
        ),
      );
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    await screen.findByText("Dates saved.");
    captureTimingEvidence("saved-builder", view.container);
    expect(fetcher).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "Back to plan" }));
    await waitFor(() =>
      expect(within(stepItem("Dates")).getByText("Done")).toBeInTheDocument(),
    );
  });

  it("makes missing commercial inputs explicit", () => {
    render(<BasketBuilder basket={basket} />);

    expect(within(stepsCard()).getByText("0 of 2 done")).toBeInTheDocument();
    expect(stepItem("Target")).toHaveTextContent(
      "To do · Set a baseline and the number you’re aiming for",
    );
    expect(stepItem("Creator terms")).toHaveTextContent(
      "To do · 0 of 1 ready · Maya / Chain Mode has no terms yet",
    );
    expect(screen.getByText("2 steps left:")).toBeInTheDocument();
    expect(screen.getByText("Terms needed")).toBeInTheDocument();
    const commitment = screen.getByRole("region", {
      name: "Known fixed commitment",
    });
    expect(commitment).toHaveTextContent("None yet");
    expect(commitment).toHaveTextContent(
      "1 included creator has no complete terms, so this is a partial total",
    );
    const cost = screen.getByRole("region", {
      name: "Cost per qualified wallet",
    });
    expect(cost).toHaveTextContent("Not available yet");
    expect(cost).toHaveTextContent(
      "Shows once every included creator has terms.",
    );
    expect(cost).toHaveTextContent("Target until results");
    expect(
      within(screen.getByRole("table")).getByText("Not available yet"),
    ).toBeInTheDocument();
    expect(screen.queryByText("£0")).not.toBeInTheDocument();
    expect(screen.queryByText(/New on Landed/i)).not.toBeInTheDocument();
  });

  it("opens the first unfinished step from the hero and never approves", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<BasketBuilder basket={basket} />);
    fireEvent.click(screen.getByRole("button", { name: /Review and approve/ }));
    expect(drawer("Target")).toBeVisible();
    expect(window.location.search).toContain("step=target");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("takes the user from a deliverable blocker to the exact package editor", () => {
    render(
      <BasketBuilder
        basket={{
          ...readyBasket,
          packages: [
            {
              ...readyBasket.packages[0]!,
              deliverableSummary: null,
            },
          ],
        }}
      />,
    );

    expect(stepItem("Creator terms")).toHaveTextContent(
      "0 of 1 ready · Maya / Chain Mode needs a fix",
    );
    expect(
      within(screen.getByRole("table")).getByText(
        "Add what this creator will deliver.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Finish Maya / Chain Mode’s terms",
      }),
    ).toBeInTheDocument();

    const panel = openTerms("Fix terms for Maya / Chain Mode");
    expect(panel).toHaveAccessibleName("Terms for Maya / Chain Mode");
    expect(window.location.hash).toBe(`#basket-package-${packageId}`);
    expect(
      within(panel).getByRole("form", {
        name: "Commercial terms for Maya / Chain Mode",
      }),
    ).toBeInTheDocument();
    expect(within(panel).getByRole("status")).toHaveTextContent(
      "Add what this creator will deliver.",
    );
  });

  it("varies a shared package in one scenario only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({ included: false }),
        ok: true,
        status: 200,
      })),
    );
    render(<BasketBuilder basket={basket} />);

    fireEvent.click(
      screen.getByLabelText("Include Maya / Chain Mode in scenario A"),
    );

    expect(
      await screen.findByRole("heading", {
        name: "0 of 1 candidate in scenario A",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Include Maya / Chain Mode in scenario A"),
    ).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "B · Broad reach" }));
    expect(
      screen.getByRole("button", { name: "B · Broad reach" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByLabelText("Include Maya / Chain Mode in scenario B"),
    ).toBeChecked();
  });

  it("rolls back an optimistic change when persistence fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({ message: "Scenario changes require access." }),
        ok: false,
        status: 403,
      })),
    );
    render(<BasketBuilder basket={basket} />);
    const checkbox = screen.getByLabelText(
      "Include Maya / Chain Mode in scenario A",
    );

    fireEvent.click(checkbox);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Scenario changes require access.",
    );
    expect(checkbox).toBeChecked();
  });

  it("preserves a successful concurrent change when another edge rolls back", async () => {
    const secondPackageId = "92000000-0000-4000-8000-000000000002";
    const concurrentBasket: BasketRecord = {
      ...basket,
      scenarios: basket.scenarios.map((scenario) => ({
        ...scenario,
        packageIds: [...scenario.packageIds, secondPackageId],
      })),
      packages: [
        ...basket.packages,
        {
          id: secondPackageId,
          creatorId: "40000000-0000-4000-8000-000000000002",
          creatorName: "Solana Sensei",
          creatorHandle: "@solsensei",
          audience: {
            channelType: "x",
            size: 218000,
            observedAt: "2026-07-01T12:00:00.000Z",
            sourceLabel: "Seeded demonstration evidence",
          },
          packageLabel: "Education package",
          deliverableSummary: "Two X threads",
          sourceRateQuoteId: null,
          compensationLines: [],
        },
      ],
    };
    let resolveFirst:
      | ((value: {
          json: () => Promise<{ message: string }>;
          ok: boolean;
          status: number;
        }) => void)
      | undefined;
    const firstResponse = new Promise<{
      json: () => Promise<{ message: string }>;
      ok: boolean;
      status: number;
    }>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValueOnce({
        json: async () => ({ included: false }),
        ok: true,
        status: 200,
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<BasketBuilder basket={concurrentBasket} />);
    const maya = screen.getByLabelText(
      "Include Maya / Chain Mode in scenario A",
    );
    const sensei = screen.getByLabelText("Include Solana Sensei in scenario A");

    fireEvent.click(maya);
    fireEvent.click(sensei);

    await waitFor(() => expect(sensei).not.toBeChecked());
    expect(maya).toBeDisabled();

    await act(async () => {
      resolveFirst?.({
        json: async () => ({ message: "First edge failed." }),
        ok: false,
        status: 500,
      });
      await firstResponse;
    });

    expect(maya).toBeChecked();
    expect(sensei).not.toBeChecked();
  });

  it("does not expose basket data in the permission state", () => {
    render(<BasketBuilderPermission />);

    expect(
      screen.getByRole("heading", { name: "This plan isn’t available" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Maya / Chain Mode")).not.toBeInTheDocument();
  });

  it("recalculates exact scenario totals after commercial terms are saved", async () => {
    const savedPackage = {
      ...basket.packages[0]!,
      compensationLines: [{ ...fixedCashLine, amountMinor: "125042" }],
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return {
          json: async () => ({ package: savedPackage }),
          ok: true,
          status: 200,
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<BasketBuilder basket={basket} />);

    const panel = openTerms();
    fireEvent.change(within(panel).getByLabelText("Amount (payment line 1)"), {
      target: { value: "1250.42" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Save terms" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual(
      expect.objectContaining({
        compensationLines: [
          expect.objectContaining({
            assetType: "cash",
            amount: "1250.42",
            currencyCode: "GBP",
          }),
        ],
      }),
    );
    expect(
      await within(panel).findByText(
        "Terms saved. The scenario total is updated.",
      ),
    ).toBeInTheDocument();
    const commitment = screen.getByRole("region", {
      name: "Known fixed commitment",
    });
    expect(commitment).toHaveTextContent("£1,250.42");
    expect(commitment).toHaveTextContent("agreed, not paid");
    expect(screen.getByText("£1,250.42 fixed")).toBeInTheDocument();

    fireEvent.change(within(panel).getByLabelText("Amount (payment line 1)"), {
      target: { value: "1400" },
    });

    expect(
      screen.queryByText("Terms saved. The scenario total is updated."),
    ).not.toBeInTheDocument();
    expect(commitment).toHaveTextContent("£1,250.42");
  });

  it("shows mixed fixed currencies as components without an FX total", () => {
    const mixedBasket: BasketRecord = {
      ...basket,
      scenarios: basket.scenarios.map((scenario) => ({
        ...scenario,
        packageIds: [
          "92000000-0000-4000-8000-000000000001",
          "92000000-0000-4000-8000-000000000002",
        ],
      })),
      packages: [
        {
          ...basket.packages[0]!,
          compensationLines: [{ ...fixedCashLine, amountMinor: "125042" }],
        },
        {
          ...basket.packages[0]!,
          compensationLines: [
            {
              ...fixedCashLine,
              id: "93000000-0000-4000-8000-000000000003",
              amountMinor: "50000",
              currencyCode: "USD",
            },
          ],
          creatorId: "40000000-0000-4000-8000-000000000002",
          creatorName: "Solana Sensei",
          id: "92000000-0000-4000-8000-000000000002",
        },
      ],
    };

    render(<BasketBuilder basket={mixedBasket} />);
    const totals = screen.getByRole("region", {
      name: "Known fixed commitment",
    });

    expect(totals).toHaveTextContent("£1,250.42");
    expect(totals).toHaveTextContent("$500");
    expect(totals).toHaveTextContent(
      "Currencies are shown separately. No conversion is applied.",
    );
    expect(
      screen.getByRole("region", { name: "Cost per qualified wallet" }),
    ).toHaveTextContent(
      "Terms use more than one currency, so there's no single cost.",
    );
  });

  it("reveals required token valuation evidence only for token terms", () => {
    render(<BasketBuilder basket={basket} />);

    const panel = openTerms();
    expect(
      within(panel).queryByLabelText("Token mint (payment line 1)"),
    ).toBeNull();
    fireEvent.change(within(panel).getByLabelText("Asset (payment line 1)"), {
      target: { value: "token" },
    });

    expect(
      within(panel).getByLabelText("Token mint (payment line 1)"),
    ).toBeRequired();
    expect(
      within(panel).getByLabelText("Unit price USD (payment line 1)"),
    ).toBeRequired();
    expect(
      within(panel).getByLabelText("Price source (payment line 1)"),
    ).toBeRequired();
    expect(
      within(panel).getByLabelText("Valuation time (payment line 1)"),
    ).toBeRequired();
  });

  it("shows an evidence-labelled wallet forecast and a forecast cost per wallet", () => {
    render(<BasketBuilder basket={readyBasket} />);

    const wallets = screen.getByRole("region", {
      name: "Expected qualified wallets",
    });
    expect(wallets).toHaveTextContent("28likely · range 8–85");
    expect(wallets).toHaveTextContent(
      "Forecast · low · likely · high (P25 / base / P75) · target 150",
    );
    expect(wallets).toHaveTextContent(
      "Very low confidence · audience evidence for 1 of 1 creator",
    );
    const cost = screen.getByRole("region", {
      name: "Cost per qualified wallet",
    });
    // £4,600 / 28 = £164.29 → £164; P75 85 → £54; P25 8 → £575.
    expect(cost).toHaveTextContent("£164likely");
    expect(cost).toHaveTextContent("Range £54 – £575");
    expect(cost).toHaveTextContent(
      "Target until results · forecast · lower is better",
    );
  });

  it("saves a defined AOV outcome in integer minor units", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        return {
          json: async () => JSON.parse(String(init?.body)),
          ok: true,
          status: 200,
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<BasketBuilder basket={basket} />);

    fireEvent.click(within(stepItem("Target")).getByRole("button"));
    fireEvent.change(screen.getByLabelText("Campaign objective"), {
      target: { value: "Increase order value from qualified wallets" },
    });
    fireEvent.change(screen.getByLabelText("Primary KPI"), {
      target: { value: "average_order_value" },
    });
    fireEvent.change(screen.getByLabelText("Baseline"), {
      target: { value: "42" },
    });
    fireEvent.change(screen.getByLabelText("Target", { selector: "input" }), {
      target: { value: "52" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save target" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual({
      objective: "Increase order value from qualified wallets",
      outcomeProfile: {
        baselineUnits: "4200",
        currencyCode: "GBP",
        metric: "average_order_value",
        targetUnits: "5200",
      },
    });
    expect(
      await screen.findByRole("heading", {
        name: "Increase order value from qualified wallets",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("£52")).toBeInTheDocument();
    expect(
      within(stepItem("Target")).getByText("Editing now"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to plan" }));
    expect(within(stepItem("Target")).getByText("Done")).toBeInTheDocument();
  });

  it("keeps the wallet target value and unit in one contained display", () => {
    render(<BasketBuilder basket={readyBasket} />);

    expect(stepItem("Target")).toHaveTextContent("Done · 50 → 150 wallets");
    fireEvent.click(screen.getByRole("button", { name: "Edit: Target" }));
    const outcome = screen.getByRole("region", { name: "Campaign outcome" });
    const targetDisplay = within(outcome).getByText("150 wallets");
    expect(targetDisplay.tagName).toBe("DD");
    expect(
      within(outcome).getByRole("button", { name: "Edit target" }),
    ).toBeInTheDocument();
  });

  it("opens commercial terms for the selected creator in its own drawer", () => {
    render(<BasketBuilder basket={basket} />);

    expect(
      screen.queryByRole("form", {
        name: "Commercial terms for Maya / Chain Mode",
      }),
    ).not.toBeInTheDocument();

    const opener = screen.getByRole("button", {
      name: "Add terms for Maya / Chain Mode",
    });
    opener.focus();
    const panel = openTerms();
    const editor = within(panel).getByRole("form", {
      name: "Commercial terms for Maya / Chain Mode",
    });
    expect(editor).toHaveAttribute("id", `package-terms-${packageId}`);

    fireEvent.click(
      within(panel).getByRole("button", { name: "Back to plan" }),
    );

    expect(
      screen.queryByRole("form", {
        name: "Commercial terms for Maya / Chain Mode",
      }),
    ).not.toBeInTheDocument();
  });

  it("records an unpaid internal test as a basis instead of a zero fee", async () => {
    const editablePackage = {
      ...basket.packages[0]!,
      commercialDetailRevision: 1,
      commercialDetail: {
        schemaVersion: 2 as const,
        channelIds: [],
        deliveryDeadline: null,
        usageRights: null,
        exclusivity: null,
        commercialBasis: "compensated" as const,
        unpaidReason: null,
      },
      compensationLines: [{ ...fixedCashLine, amountMinor: "10000" }],
    };
    const saved = {
      ...editablePackage,
      compensationLines: [],
      commercialDetailRevision: 3,
      commercialDetail: {
        ...editablePackage.commercialDetail,
        commercialBasis: "unpaid_internal_test" as const,
        unpaidReason: "Approved internal devnet response proof.",
      },
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return Promise.resolve({
          json: async () => ({ package: saved }),
          ok: true,
          status: 200,
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <BasketBuilder basket={{ ...basket, packages: [editablePackage] }} />,
    );

    const panel = openTerms("Edit terms for Maya / Chain Mode");
    fireEvent.change(within(panel).getByLabelText("Commercial basis"), {
      target: { value: "unpaid_internal_test" },
    });
    fireEvent.change(
      within(panel).getByLabelText("Unpaid internal test reason"),
      { target: { value: "Approved internal devnet response proof." } },
    );
    fireEvent.click(within(panel).getByRole("button", { name: "Save terms" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      compensationLines: [],
      commercialDetail: {
        schemaVersion: 2,
        commercialBasis: "unpaid_internal_test",
        unpaidReason: "Approved internal devnet response proof.",
      },
    });
    expect((await screen.findAllByText("Unpaid test")).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText("£0")).not.toBeInTheDocument();
  });

  it("keeps commercial approval blocked until the plan is complete", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    window.history.replaceState(null, "", "/?step=review");
    render(<BasketBuilder basket={basket} />);

    const panel = drawer("Review and approve");
    expect(panel).toHaveTextContent("2 things to finish before approval");
    expect(panel).toHaveTextContent("Set the target.");
    expect(
      within(panel).getByRole("button", { name: "Finish the steps first" }),
    ).toBeDisabled();
    fireEvent.click(within(panel).getByRole("link", { name: "Set target" }));
    expect(drawer("Target")).toBeVisible();
    expect(fetcher).not.toHaveBeenCalled();
    window.history.replaceState(null, "", "/");
  });

  it("requires human confirmation before issuing an approved version", async () => {
    const approval = {
      id: "94000000-0000-4000-8000-000000000001",
      scenarioId: basket.scenarios[0]!.id,
      scenarioCode: "A" as const,
      scenarioName: "Focused authority",
      version: 1,
      approvedBy: "30000000-0000-4000-8000-000000000001",
      approvedAt: "2026-08-05T00:30:00.000Z",
      reason: "Approved for the pilot launch",
      snapshotHash:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const review = {
      snapshot: {
        schemaVersion: 1 as const,
        basket: {
          id: basket.id,
          name: basket.name,
          objective: "Increase qualified wallets",
          outcomeProfile: {
            baselineUnits: "50",
            metric: "qualified_wallets" as const,
            targetUnits: "150",
          },
        },
        scenario: {
          id: basket.scenarios[0]!.id,
          code: "A" as const,
          name: "Focused authority",
        },
        packages: [
          {
            id: basket.packages[0]!.id,
            creatorId: basket.packages[0]!.creatorId,
            packageLabel: "Creator launch package",
            deliverableSummary: "One launch thread",
            compensationLines: [
              {
                id: "93000000-0000-4000-8000-000000000001",
                assetType: "cash" as const,
                model: "fixed" as const,
                amountMinor: "460000",
                currencyCode: "GBP" as const,
              },
              {
                id: "93000000-0000-4000-8000-000000000002",
                assetType: "cash" as const,
                model: "variable" as const,
                variableUnit: "Qualified wallet",
                amountMinor: "2500",
                currencyCode: "GBP" as const,
              },
            ],
          },
        ],
      },
      snapshotHash: approval.snapshotHash,
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        return {
          json: async () =>
            init?.method === "POST" ? { approval } : { review },
          ok: true,
          status: 200,
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<BasketBuilder basket={readyBasket} />);

    expect(screen.getByText("Ready to review")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Review and approve/ }));
    const panel = drawer("Review and approve");
    expect(panel).toHaveTextContent(
      "Approving locks the selected terms into the plan. It doesn’t send offers, pay creators or go live.",
    );
    fireEvent.click(
      within(panel).getByRole("button", { name: "Review the selected terms" }),
    );
    const approveButton = await within(panel).findByRole("button", {
      name: "Approve selected terms",
    });

    expect(within(panel).getByText("Creator launch package")).toBeVisible();
    expect(within(panel).getByText("aaaaaaaaaaaaaaaa…")).toBeVisible();
    expect(within(panel).getByText("GBP 4600 · fixed")).toBeVisible();
    expect(
      within(panel).getByText("GBP 25 · variable · per Qualified wallet"),
    ).toBeVisible();
    expect(approveButton).toBeDisabled();
    fireEvent.change(within(panel).getByLabelText("Approval reason"), {
      target: { value: approval.reason },
    });
    expect(approveButton).toBeDisabled();
    fireEvent.click(
      within(panel).getByLabelText(
        "I’ve reviewed the selected creators, deliverables and terms. Approving locks them as version 1.",
      ),
    );
    fireEvent.click(approveButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const requestInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual(
      expect.objectContaining({
        scenarioId: basket.scenarios[0]!.id,
        reason: approval.reason,
        confirmation: "APPROVE COMMERCIAL PLAN",
        expectedSnapshotHash: review.snapshotHash,
      }),
    );
    expect(
      await screen.findByText("Approved · terms locked (version 1)"),
    ).toBeInTheDocument();
    captureHandoff("basket-approved", "baskets");
    expect(
      within(panel).getByText(
        "Version 1 approved. The selected terms are locked; nothing has been sent or paid.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Close and return to the plan",
      }),
    );
    expect(
      screen.getByRole("link", { name: /Continue to campaign/ }),
    ).toHaveAttribute("href", `/projects/helios/campaigns?plan=${approval.id}`);
    expect(stepsCard()).toHaveAccessibleName("Plan details");
  });

  it("shows exact token quantity, mint, price source and valuation time", async () => {
    const tokenMint = "So11111111111111111111111111111111111111112";
    const valuedAt = "2026-08-05T00:00:00.000Z";
    const tokenLine = {
      id: "93000000-0000-4000-8000-000000000003",
      assetType: "token" as const,
      model: "fixed" as const,
      variableUnit: null,
      tokenMint,
      tokenAmountRaw: "125000000",
      tokenDecimals: 6,
      unitPriceUsd: "2.5",
      priceSource: "Treasury valuation policy",
      valuedAt,
      createdAt: valuedAt,
      updatedAt: valuedAt,
    };
    const review = {
      snapshot: {
        schemaVersion: 1,
        basket: {
          id: basket.id,
          name: basket.name,
          objective: "Increase qualified wallets",
          outcomeProfile: {
            baselineUnits: "50",
            metric: "qualified_wallets",
            targetUnits: "150",
          },
        },
        scenario: {
          id: basket.scenarios[0]!.id,
          code: "A",
          name: "Focused authority",
        },
        packages: [
          {
            id: basket.packages[0]!.id,
            creatorId: basket.packages[0]!.creatorId,
            packageLabel: "Token launch package",
            deliverableSummary: "One launch thread",
            compensationLines: [
              {
                id: tokenLine.id,
                assetType: tokenLine.assetType,
                model: tokenLine.model,
                tokenMint,
                tokenAmountRaw: tokenLine.tokenAmountRaw,
                tokenDecimals: tokenLine.tokenDecimals,
                unitPriceUsd: tokenLine.unitPriceUsd,
                priceSource: tokenLine.priceSource,
                valuedAt,
              },
            ],
          },
        ],
      },
      snapshotHash:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({ review }),
        ok: true,
        status: 200,
      })),
    );

    render(
      <BasketBuilder
        basket={{
          ...readyBasket,
          packages: [
            {
              ...basket.packages[0]!,
              deliverableSummary: "One launch thread",
              compensationLines: [tokenLine],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("125 tokens fixed")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Cost per qualified wallet" }),
    ).toHaveTextContent("Not available yet");
    fireEvent.click(screen.getByRole("button", { name: /Review and approve/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Review the selected terms" }),
    );

    expect(await screen.findByText("Token 125 · fixed")).toBeInTheDocument();
    expect(
      screen.getByText(
        `Mint ${tokenMint} · unit price USD 2.5 · Treasury valuation policy · valued ${valuedAt}`,
      ),
    ).toBeInTheDocument();
  });

  it("shows a distinct approval permission state to analysts", () => {
    render(<BasketBuilder basket={basket} canManage={false} />);

    expect(
      screen.queryByRole("button", { name: /Review and approve/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Only a campaign manager can review and approve this plan.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Include Maya / Chain Mode in scenario A"),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "View terms for Maya / Chain Mode" }),
    ).toBeEnabled();
  });

  it("lets viewers read target and terms without any save action", () => {
    render(<BasketBuilder basket={readyBasket} canManage={false} />);
    fireEvent.click(
      screen.getByRole("button", { name: "View terms for Maya / Chain Mode" }),
    );
    const panel = drawer(/Terms for/);
    expect(
      within(panel).getByRole("region", { name: /Saved terms for/ }),
    ).toHaveTextContent("GBP 4600 · fixed");
    expect(panel.querySelector("input, select, textarea")).toBeNull();
    expect(
      within(panel).queryByRole("button", { name: "Save terms" }),
    ).toBeNull();
    expect(panel).toHaveTextContent(
      "Read-only access to saved deliverables and compensation.",
    );
    fireEvent.click(
      within(panel).getByRole("button", { name: "Back to plan" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "View: Target" }));
    expect(
      screen.getByRole("region", { name: "Campaign outcome" }),
    ).toHaveTextContent("150 wallets");
    expect(screen.queryByRole("button", { name: "Edit target" })).toBeNull();
  });

  it("labels an issued approval as historical after the draft changes", () => {
    window.history.replaceState(null, "", "/?step=review");
    render(
      <BasketBuilder
        basket={{
          ...basket,
          latestApproval: {
            id: "94000000-0000-4000-8000-000000000001",
            scenarioId: basket.scenarios[0]!.id,
            scenarioCode: "A",
            scenarioName: "Focused authority",
            version: 1,
            approvedBy: "30000000-0000-4000-8000-000000000001",
            approvedAt: "2026-08-05T00:30:00.000Z",
            reason: "Approved before terms changed",
            snapshotHash:
              "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
          latestApprovalIsCurrent: false,
        }}
      />,
    );

    expect(
      screen.getByText("Changed since approved version 1"),
    ).toBeInTheDocument();
    captureHandoff("basket-historical", "baskets");
    expect(
      screen.queryByRole("link", { name: /Continue to campaign/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "This draft has changed since version 1 was approved. Review and approve again before it can be used.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to plan" }));
    fireEvent.click(within(stepItem("Creator terms")).getByRole("button"));
    expect(drawer()).toHaveTextContent(
      "Saved terms · read only. This plan differs from its previous approval.",
    );
    expect(drawer()).not.toHaveTextContent("Approved terms · read only");
    window.history.replaceState(null, "", "/");
  });

  it("keeps scenario removal visible beside package editing", () => {
    render(<BasketBuilder basket={basket} />);
    const row = screen
      .getByLabelText("Include Maya / Chain Mode in scenario A")
      .closest("tr")!;
    expect(
      within(row).getByRole("button", {
        name: "Add terms for Maya / Chain Mode",
      }),
    ).toBeInTheDocument();
  });
});

describe("outcome target validation", () => {
  function okFetch() {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        return {
          json: async () => JSON.parse(String(init?.body)),
          ok: true,
          status: 200,
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function fillOutcome({
    metric = "qualified_wallets",
    baseline,
    target,
  }: {
    metric?: string;
    baseline: string;
    target: string;
  }) {
    if (screen.queryByRole("region", { name: /steps to approval/ }))
      fireEvent.click(within(stepItem("Target")).getByRole("button"));
    fireEvent.change(screen.getByLabelText("Campaign objective"), {
      target: { value: "Grow qualified wallets" },
    });
    fireEvent.change(screen.getByLabelText("Primary KPI"), {
      target: { value: metric },
    });
    fireEvent.change(screen.getByLabelText("Baseline"), {
      target: { value: baseline },
    });
    fireEvent.change(screen.getByLabelText("Target", { selector: "input" }), {
      target: { value: target },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save target" }));
  }

  function sentProfile(fetchMock: ReturnType<typeof okFetch>) {
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    return JSON.parse(String(init.body)).outcomeProfile;
  }

  it.each([
    [400, null],
    [200, null],
    [400, "upstream diagnostic"],
    [200, []],
    [200, {}],
    [200, { message: "Private upstream diagnostic" }],
    [500, { message: "Outcome setup could not be saved." }],
    [400, { message: "Private upstream diagnostic" }],
  ])(
    "keeps malformed readable response %s / %j unconfirmed",
    async (status, payload) => {
      const fetchMock = vi.fn(async () => ({
        ok: status === 200,
        status,
        json: async () => payload,
      }));
      vi.stubGlobal("fetch", fetchMock);
      render(<BasketBuilder basket={basket} />);
      fillOutcome({ baseline: "50", target: "150" });
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "couldn't confirm whether the outcome was saved",
      );
      expect(
        screen.getByLabelText("Target", { selector: "input" }),
      ).toHaveValue("150");
      expect(screen.getByRole("button", { name: "Save target" })).toBeEnabled();
      expect(screen.queryByText("Target saved.")).toBeNull();
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("reports post-response handling errors without exposing exception details or promising rollback", async () => {
    const fetchMock = okFetch();
    const onSaved = vi.fn(() => {
      throw new Error("private callback diagnostic");
    });
    render(
      <OutcomeSetup
        basketId={basket.id}
        initialObjective={null}
        initialProfile={null}
        onSaved={onSaved}
      />,
    );
    fillOutcome({ baseline: "0", target: "25" });
    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent(
      "couldn't confirm whether the outcome was saved",
    );
    expect(notice).not.toHaveTextContent(/private|nothing was saved|rollback/);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onSaved).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Save target" })).toBeEnabled();
  });

  it("keeps native required validation on empty fields during button submission", () => {
    const fetchMock = okFetch();
    render(<BasketBuilder basket={basket} />);
    fillOutcome({ baseline: "", target: "50" });
    const baseline = screen.getByLabelText("Baseline") as HTMLInputElement;
    expect(baseline).toBeRequired();
    expect(baseline.validity.valueMissing).toBe(true);
    expect(baseline.form?.checkValidity()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["1,000", "wholeNumber"],
    ["10k", "wholeNumber"],
    ["1e3", "wholeNumber"],
    ["-5", "wholeNumber"],
    ["1.5", "wholeNumber"],
    ["", "wholeNumber"],
  ] as const)(
    "rejects wallet count %j without converting or rounding",
    (raw, message) => {
      expect(parseOutcomeValue(raw, "qualified_wallets", "baseline")).toEqual({
        error: outcomeValueMessages[message],
      });
    },
  );

  it.each([
    ["1,000.00"],
    ["10k"],
    ["2e2"],
    ["-1"],
    ["25.505"],
    [".5"],
    ["5."],
    ["025"],
    ["£25"],
  ])("rejects money amount %j", (raw) => {
    expect(parseOutcomeValue(raw, "verified_revenue", "target")).toEqual({
      error: outcomeValueMessages.amount,
    });
  });

  it("allows a zero baseline but not a zero target", () => {
    expect(parseOutcomeValue("0", "qualified_wallets", "baseline")).toEqual({
      units: "0",
    });
    expect(parseOutcomeValue("0", "qualified_wallets", "target")).toEqual({
      error: outcomeValueMessages.aboveZero,
    });
    expect(parseOutcomeValue("0.00", "average_order_value", "target")).toEqual({
      error: outcomeValueMessages.aboveZero,
    });
    expect(parseOutcomeValue("0", "average_order_value", "baseline")).toEqual({
      units: "0",
    });
  });

  it("keeps whole counts and money exact, including beyond safe-number range", () => {
    expect(
      parseOutcomeValue("9007199254740993", "qualified_wallets", "target"),
    ).toEqual({ units: "9007199254740993" });
    expect(parseOutcomeValue(" 250 ", "qualified_wallets", "target")).toEqual({
      units: "250",
    });
    expect(parseOutcomeValue("25.5", "verified_revenue", "target")).toEqual({
      units: "2550",
    });
    expect(parseOutcomeValue("25.50", "verified_revenue", "target")).toEqual({
      units: "2550",
    });
    expect(
      parseOutcomeValue("90071992547409.93", "average_order_value", "target"),
    ).toEqual({ units: "9007199254740993" });
  });

  it("names each invalid field, keeps what was typed and sends nothing", async () => {
    const fetchMock = okFetch();
    render(<BasketBuilder basket={basket} />);

    fillOutcome({ baseline: "1,000", target: "0" });

    const baseline = screen.getByLabelText("Baseline");
    const target = screen.getByLabelText("Target", { selector: "input" });
    expect(baseline).toHaveValue("1,000");
    expect(target).toHaveValue("0");
    expect(baseline).toHaveAttribute("aria-invalid", "true");
    expect(baseline).toHaveAccessibleDescription(
      outcomeValueMessages.wholeNumber,
    );
    expect(target).toHaveAccessibleDescription(outcomeValueMessages.aboveZero);
    await waitFor(() => expect(baseline).toHaveFocus());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/BigInt/)).not.toBeInTheDocument();
  });

  it("clears a field's error once it is edited", () => {
    okFetch();
    render(<BasketBuilder basket={basket} />);
    fillOutcome({ baseline: "10k", target: "250" });

    const baseline = screen.getByLabelText("Baseline");
    expect(baseline).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(baseline, { target: { value: "10000" } });
    expect(baseline).not.toHaveAttribute("aria-invalid");
    expect(
      screen.queryByText(outcomeValueMessages.wholeNumber),
    ).not.toBeInTheDocument();
  });

  it("rejects over-precise money with a field error and no request", () => {
    const fetchMock = okFetch();
    render(<BasketBuilder basket={basket} />);
    fillOutcome({
      metric: "average_order_value",
      baseline: "42",
      target: "25.505",
    });

    expect(
      screen.getByLabelText("Target", { selector: "input" }),
    ).toHaveAccessibleDescription(outcomeValueMessages.amount);
    expect(screen.getByLabelText("Target", { selector: "input" })).toHaveValue(
      "25.505",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the unchanged payload for valid wallet counts", async () => {
    const fetchMock = okFetch();
    render(<BasketBuilder basket={basket} />);
    fillOutcome({ baseline: "0", target: "9007199254740993" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentProfile(fetchMock)).toEqual({
      baselineUnits: "0",
      currencyCode: null,
      metric: "qualified_wallets",
      targetUnits: "9007199254740993",
    });
    expect(await screen.findByText("Target saved.")).toBeInTheDocument();
  });

  it("sends one- and two-decimal money in exact minor units", async () => {
    const fetchMock = okFetch();
    render(<BasketBuilder basket={basket} />);
    fillOutcome({
      metric: "verified_revenue",
      baseline: "10.5",
      target: "25.50",
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentProfile(fetchMock)).toEqual({
      baselineUnits: "1050",
      currencyCode: "GBP",
      metric: "verified_revenue",
      targetUnits: "2550",
    });
  });

  it("is honest when a request's outcome can't be confirmed", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch: net::ERR_INTERNET_DISCONNECTED");
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<BasketBuilder basket={basket} />);
    fillOutcome({ baseline: "50", target: "150" });

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent(
      "We couldn't confirm whether the outcome was saved.",
    );
    expect(notice).not.toHaveTextContent(/ERR_|Failed to fetch|nothing/i);
    expect(screen.getByLabelText("Target", { selector: "input" })).toHaveValue(
      "150",
    );
  });

  it("treats an unreadable response as unconfirmed, not as saved or failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON at position 0");
        },
        ok: false,
        status: 502,
      })),
    );
    render(<BasketBuilder basket={basket} />);
    fillOutcome({ baseline: "50", target: "150" });

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("couldn't confirm whether");
    expect(notice).not.toHaveTextContent(/Unexpected token/);
  });

  it.each([
    [400, "Outcome setup was not valid."],
    [403, "Outcome changes require campaign manager access."],
    [404, "Basket was not found."],
  ])(
    "keeps the server's known %s domain rejection",
    async (status, message) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          json: async () => ({ message }),
          ok: false,
          status,
        })),
      );
      render(<BasketBuilder basket={basket} />);
      fillOutcome({ baseline: "50", target: "150" });

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
    },
  );

  it.each([
    "objective",
    "metric",
    "baselineUnits",
    "targetUnits",
    "currencyCode",
  ])(
    "does not claim a save when the returned %s differs from the request",
    async (field) => {
      const fetcher = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const returned = JSON.parse(String(init?.body));
          if (field === "objective") returned.objective = "Another objective";
          else if (field === "metric")
            returned.outcomeProfile.metric = "average_order_value";
          else if (field === "currencyCode")
            returned.outcomeProfile.currencyCode = "USD";
          else returned.outcomeProfile[field] = "9999";
          return { ok: true, status: 200, json: async () => returned };
        },
      );
      vi.stubGlobal("fetch", fetcher);
      render(<BasketBuilder basket={basket} />);
      fillOutcome({
        metric: "verified_revenue",
        baseline: "10.5",
        target: "25.50",
      });
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "couldn't confirm whether",
      );
      expect(
        screen.getByLabelText("Target", { selector: "input" }),
      ).toHaveValue("25.50");
      expect(
        screen.queryByRole("region", { name: "Campaign outcome" }),
      ).toBeNull();
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
});

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import type { BasketOutcomeProfile } from "@landed/contracts";
import { afterEach, expect, it, vi } from "vitest";
import {
  BasketWorkspace,
  planPanelForHash,
  planPanelFromUrl,
  type PlanPanel,
} from "./basket-workspace";
import { OutcomeSetup } from "./basket-builder";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const props = { name: "Test plan", purpose: "Finish the steps." };

it.each([
  ["purpose", "dialog"],
  ["measurement", "dialog"],
  ["target", "dialog"],
  ["dates", "dialog"],
  ["terms", "dialog"],
  ["review", "dialog"],
  ["compare", "drawer"],
] as const)("opens %s as a %s without saving", async (id, presentation) => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(
    <BasketWorkspace
      {...props}
      panels={[
        { id, eyebrow: "Test plan", title: id, content: <p>Details</p> },
      ]}
    >
      {(open) => <button onClick={() => open(id)}>Open panel</button>}
    </BasketWorkspace>,
  );
  const opener = screen.getByRole("button", { name: "Open panel" });
  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByRole("dialog")).toHaveAttribute(
    "data-presentation",
    presentation,
  );
  expect(screen.getByRole("heading", { name: id })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(opener).toHaveFocus());
  expect(fetcher).not.toHaveBeenCalled();
});

function dialog() {
  return screen.queryByRole("dialog");
}

const savePanel: PlanPanel = {
  id: "measurement",
  eyebrow: "Draft",
  title: "Choose a result",
  content: (
    <form data-plan-save="true" onSubmit={(event) => event.preventDefault()}>
      <button type="submit">Save test choice</button>
    </form>
  ),
};

it("closes only after a confirmed save and restores focus to its opener", async () => {
  const content = (confirmation?: {
    id: number;
    panel: "measurement";
    message: string;
  }) => (
    <BasketWorkspace
      {...props}
      panels={[savePanel]}
      saveConfirmation={confirmation}
    >
      {(open) => (
        <button onClick={() => open("measurement")}>Choose result</button>
      )}
    </BasketWorkspace>
  );
  const view = render(content());
  const opener = screen.getByRole("button", { name: "Choose result" });
  opener.focus();
  fireEvent.click(opener);
  fireEvent.click(screen.getByRole("button", { name: "Save test choice" }));
  expect(dialog()).not.toBeNull();
  view.rerender(
    content({ id: 1, panel: "measurement", message: "Choice saved" }),
  );
  await waitFor(() => expect(dialog()).toBeNull());
  await waitFor(() => expect(opener).toHaveFocus());
  expect(screen.getByRole("status")).toHaveTextContent("Choice saved");
  expect(new URL(window.location.href).searchParams.has("step")).toBe(false);
  fireEvent.click(opener);
  expect(dialog()).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save test choice" }));
  view.rerender(
    content({ id: 2, panel: "measurement", message: "Choice saved" }),
  );
  await waitFor(() => expect(dialog()).toBeNull());
  expect(screen.getByRole("status")).toHaveTextContent("Choice saved");
});

it.each(["reopened", "different"])(
  "a slow save does not close a %s panel",
  async (kind) => {
    const content = (confirmation?: {
      id: number;
      panel: "measurement";
      message: string;
    }) => (
      <BasketWorkspace
        {...props}
        panels={[
          savePanel,
          {
            id: "dates",
            eyebrow: "Draft",
            title: "Dates",
            content: <p>Dates form</p>,
          },
        ]}
        saveConfirmation={confirmation}
      >
        {(open) => (
          <>
            <button onClick={() => open("measurement")}>Choose result</button>
            <button onClick={() => open("dates")}>Choose dates</button>
          </>
        )}
      </BasketWorkspace>
    );
    const view = render(content());
    fireEvent.click(screen.getByRole("button", { name: "Choose result" }));
    fireEvent.click(screen.getByRole("button", { name: "Save test choice" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to plan" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: kind === "reopened" ? "Choose result" : "Choose dates",
      }),
    );
    view.rerender(
      content({ id: 1, panel: "measurement", message: "Choice saved" }),
    );
    expect(screen.getByRole("dialog")).toHaveAccessibleName(
      kind === "reopened" ? "Choose a result" : "Dates",
    );
  },
);

function WorkspaceWithOutcome() {
  const [saved, setSaved] = useState<{
    objective: string;
    profile: BasketOutcomeProfile;
  } | null>(null);
  const panels: PlanPanel[] = [
    {
      id: "target",
      eyebrow: "Step 1 of 2",
      title: "Target",
      content: (
        <OutcomeSetup
          basketId="90000000-0000-4000-8000-000000000001"
          initialObjective={saved?.objective ?? null}
          initialProfile={saved?.profile ?? null}
          onSaved={(objective, profile) => setSaved({ objective, profile })}
        />
      ),
    },
    {
      id: "review",
      eyebrow: "Test plan",
      title: "Review and approve",
      content: (
        <section id="basket-plan-review" tabIndex={-1}>
          <a href="#basket-outcome">Resolve outcome</a>
        </section>
      ),
    },
  ];
  return (
    <BasketWorkspace {...props} panels={panels}>
      {(open) => (
        <>
          <button type="button" onClick={() => open("target")}>
            Set target
          </button>
          <button type="button" onClick={() => open("review")}>
            Review
          </button>
        </>
      )}
    </BasketWorkspace>
  );
}

function fillOutcome(target = "250") {
  fireEvent.change(screen.getByLabelText("Campaign objective"), {
    target: { value: "Grow qualified wallets" },
  });
  fireEvent.change(screen.getByLabelText("Baseline"), {
    target: { value: "0" },
  });
  fireEvent.change(screen.getByLabelText("Target", { selector: "input" }), {
    target: { value: target },
  });
}

function closeDrawer() {
  fireEvent.click(
    screen.getByRole("button", { name: "Close and return to the plan" }),
  );
}

it("maps existing editor anchors and ?step= to the step that shows them", () => {
  expect(planPanelForHash("#basket-package-123")).toBe("terms");
  expect(planPanelForHash("#package-terms-123")).toBe("terms");
  expect(planPanelForHash("#basket-outcome")).toBe("target");
  expect(planPanelForHash("#basket-strategy")).toBe("purpose");
  expect(planPanelForHash("#basket-measurement")).toBe("measurement");
  expect(planPanelForHash("#basket-timing")).toBe("dates");
  expect(planPanelForHash("#commercial-approval")).toBe("review");
  expect(planPanelForHash("#unknown")).toBeNull();
  expect(planPanelFromUrl(new URL("https://example.com/?step=dates"))).toBe(
    "dates",
  );
  expect(planPanelFromUrl(new URL("https://example.com/?step=bad"))).toBe(null);
});

it("restores the opener when browser history closes a drawer", async () => {
  render(<WorkspaceWithOutcome />);
  const opener = screen.getByRole("button", { name: "Set target" });
  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByRole("heading", { name: "Target" })).toHaveFocus();
  act(() => {
    window.history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await waitFor(() => expect(opener).toHaveFocus());
  expect(dialog()).toBeNull();
});

it("retains real outcome text and field errors through drawers and history without saving", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const url =
    "/projects/helios/baskets/90000000-0000-4000-8000-000000000001?theme=dark";
  window.history.replaceState(null, "", url);
  render(<WorkspaceWithOutcome />);
  fireEvent.click(screen.getByRole("button", { name: "Set target" }));
  expect(screen.getByRole("dialog", { name: "Target" })).toBeVisible();
  expect(window.location.search).toContain("step=target");
  expect(window.location.search).toContain("theme=dark");
  fillOutcome("10k");
  const target = screen.getByLabelText("Target", { selector: "input" });
  fireEvent.click(screen.getByRole("button", { name: "Save target" }));
  await waitFor(() => expect(target).toHaveFocus());

  closeDrawer();
  expect(dialog()).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  fireEvent.click(screen.getByRole("link", { name: "Resolve outcome" }));
  expect(screen.getByRole("dialog", { name: "Target" })).toBeVisible();
  expect(screen.getByLabelText("Target", { selector: "input" })).toBe(target);
  expect(target).toHaveValue("10k");
  expect(target).toHaveAccessibleDescription("Enter a whole number, like 250.");

  act(() => {
    window.history.replaceState(
      null,
      "",
      `${url}&unused=retained#basket-plan-review`,
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(
    screen.getByRole("dialog", { name: "Review and approve" }),
  ).toBeVisible();
  act(() => {
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(dialog()).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Set target" }));
  expect(target).toHaveValue("10k");
  expect(screen.getByLabelText("Campaign objective")).toHaveValue(
    "Grow qualified wallets",
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it("retains a pending outcome save across drawers and applies only its exact response", async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn<
    (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceWithOutcome />);
  fireEvent.click(screen.getByRole("button", { name: "Set target" }));
  fillOutcome("9007199254740993");
  fireEvent.click(screen.getByRole("button", { name: "Save target" }));
  closeDrawer();
  fireEvent.click(screen.getByRole("button", { name: "Set target" }));
  expect(screen.getByLabelText("Target", { selector: "input" })).toHaveValue(
    "9007199254740993",
  );
  const submitted = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
  expect(submitted.outcomeProfile.targetUnits).toBe("9007199254740993");
  closeDrawer();
  await act(async () => finish(new Response(JSON.stringify(submitted))));
  fireEvent.click(screen.getByRole("button", { name: "Set target" }));
  expect(
    await screen.findByRole("region", { name: "Campaign outcome" }),
  ).toHaveTextContent("Grow qualified wallets");
  expect(screen.getByText("Target saved.")).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledOnce();
});

it("keeps an unconfirmed outcome and its inputs when the drawer is closed and reopened", async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError("response lost"));
  vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceWithOutcome />);
  fireEvent.click(screen.getByRole("button", { name: "Set target" }));
  fillOutcome();
  fireEvent.click(screen.getByRole("button", { name: "Save target" }));
  await screen.findByRole("alert");
  closeDrawer();
  fireEvent.click(screen.getByRole("button", { name: "Set target" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "couldn't confirm whether the outcome was saved",
  );
  expect(screen.getByLabelText("Target", { selector: "input" })).toHaveValue(
    "250",
  );
  expect(screen.queryByRole("region", { name: "Campaign outcome" })).toBeNull();
  expect(fetcher).toHaveBeenCalledOnce();
});

it("opens the step from a deep link, makes the page inert and returns focus on close", async () => {
  window.history.replaceState(null, "", "/?source=retained#basket-outcome");
  const view = render(
    <BasketWorkspace
      {...props}
      panels={[
        {
          id: "target",
          eyebrow: "Step 1 of 1",
          title: "Target",
          content: <input aria-label="Local draft" />,
        },
      ]}
    >
      {(open) => (
        <button type="button" onClick={() => open("target")}>
          Set target
        </button>
      )}
    </BasketWorkspace>,
  );
  expect(screen.getByRole("dialog", { name: "Target" })).toBeVisible();
  expect(view.container.firstChild).toHaveAttribute(
    "data-plan-panel",
    "target",
  );
  const page = view.container.querySelector("[inert]");
  expect(page).not.toBeNull();
  const input = screen.getByLabelText("Local draft");
  fireEvent.change(input, { target: { value: "Keep edits" } });
  closeDrawer();
  expect(view.container.querySelector("[inert]")).toBeNull();
  expect(window.location.search).toBe("?source=retained");
  expect(window.location.hash).toBe("");

  const opener = screen.getByRole("button", { name: "Set target" });
  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByLabelText("Local draft")).toBe(input);
  expect(input).toHaveValue("Keep edits");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(opener).toHaveFocus());
});

it("ignores steps a plan does not have and keeps static content", () => {
  window.history.replaceState(null, "", "/?step=dates");
  render(
    <BasketWorkspace {...props}>
      <p>Legacy</p>
    </BasketWorkspace>,
  );
  expect(dialog()).toBeNull();
  expect(screen.getByText("Legacy")).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { level: 1, name: /Test plan/ }),
  ).toBeInTheDocument();
});

it("keeps one primary action and routes a fallback next action to its step", () => {
  render(
    <BasketWorkspace
      {...props}
      nextAction={{
        status: "To do",
        title: "Complete Goal and audience",
        detail: "Save the shared definition first.",
        href: "#basket-strategy",
        label: "Open Goal and audience",
      }}
      panels={[
        {
          id: "purpose",
          eyebrow: "Step 1 of 1",
          title: "Goal and audience",
          content: (
            <section id="basket-strategy" tabIndex={-1}>
              Purpose editor
            </section>
          ),
        },
      ]}
    >
      <p>Plan body</p>
    </BasketWorkspace>,
  );
  expect(screen.getByText("Complete Goal and audience")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "Open Goal and audience" }));
  expect(
    screen.getByRole("dialog", { name: "Goal and audience" }),
  ).toBeVisible();
  expect(window.location.hash).toBe("#basket-strategy");
});

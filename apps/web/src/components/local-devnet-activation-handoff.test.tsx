import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalDevnetActivationHandoff } from "./local-devnet-activation-handoff";

const campaignId = "9aa1d656-4075-4c91-935d-cd2f510fff75";
const assetId = "8aa1d656-4075-4c91-935d-cd2f510fff75";
const handoff = (status: "blocked" | "ready" | "live") => ({
  status,
  campaignId,
  campaignStatus: status === "live" ? "live" : "approved",
  commercialPlanVersionId: "7aa1d656-4075-4c91-935d-cd2f510fff75",
  commercialSnapshotHash: "a".repeat(64),
  rule: {
    id: "6aa1d656-4075-4c91-935d-cd2f510fff75",
    name: "Exact devnet receiver",
    configuredEnvironment: "devnet",
    destinationAddress: "11111111111111111111111111111111",
    nativeAmountLamports: "1",
    effectiveFrom: "2026-09-30T12:00:00.000Z",
    effectiveUntil: null,
  },
  measurement: {
    startedAt: "2026-09-30T12:00:00.000Z",
    endedAt: "2026-10-01T12:00:00.000Z",
  },
  brief: { version: 2, status: "approved" },
  destination: {
    url: "https://proof.example/measure",
    capabilityExpiresAt: "2026-09-30T13:00:00.000Z",
  },
  assets: [
    {
      contentAssetId: assetId,
      creatorId: "4aa1d656-4075-4c91-935d-cd2f510fff75",
      label: "One research thread",
      trackedLinkId:
        status === "blocked" ? null : "3aa1d656-4075-4c91-935d-cd2f510fff75",
      linkExpiresAt: status === "blocked" ? null : "2026-10-01T12:00:00.000Z",
    },
  ],
  blockers:
    status === "blocked" ? ["Issue each participant tracking link"] : [],
});

const response = (value: unknown) => ({ ok: true, json: async () => value });

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-30T12:30:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("shows the exact human blockers and issues a server-derived participant link", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(handoff("blocked")))
    .mockResolvedValueOnce(response([]))
    .mockResolvedValueOnce(response(handoff("ready")));
  vi.stubGlobal("fetch", fetch);
  render(<LocalDevnetActivationHandoff campaignId={campaignId} canManage />);
  expect(
    await screen.findByText("Issue each participant tracking link"),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Issue link for/ }));
  await screen.findByText(/Exact rule, timing, brief and participant links/);
  const submitted = JSON.parse(fetch.mock.calls[1][1].body);
  expect(submitted).toMatchObject({
    action: "issueLink",
    campaignId,
    contentAssetId: assetId,
  });
  expect(submitted.generationRequestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(submitted).not.toHaveProperty("destinationUrl");
  expect(submitted).not.toHaveProperty("receiverAddress");
});

it("requires an explicit reason and acknowledgement before live activation", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(handoff("ready")))
    .mockResolvedValueOnce(response([]))
    .mockResolvedValueOnce(response(handoff("live")));
  vi.stubGlobal("fetch", fetch);
  render(<LocalDevnetActivationHandoff campaignId={campaignId} canManage />);
  const activate = await screen.findByRole("button", {
    name: "Activate Campaign",
  });
  expect(activate).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Activation reason"), {
    target: { value: "Reviewed exact campaign activation" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed/ }));
  await waitFor(() => expect(activate).toBeEnabled());
  fireEvent.click(activate);
  await screen.findByText(/Campaign activation is recorded/);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
    action: "activate",
    campaignId,
    reason: "Reviewed exact campaign activation",
    acknowledged: true,
  });
});

it("keeps read-only reviewers away from write controls", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(handoff("ready"))));
  render(
    <LocalDevnetActivationHandoff campaignId={campaignId} canManage={false} />,
  );
  expect(await screen.findByText(/Read-only access/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Activate Campaign" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: /Copy signed link for/ }),
  ).toBeDisabled();
});

it("copies a freshly verified signed link without activating the campaign", async () => {
  const url = `http://localhost:3322/t/3aa1d656-4075-4c91-935d-cd2f510fff75?signature=${"a".repeat(43)}`;
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(handoff("ready")))
    .mockResolvedValueOnce(
      response({ url, expiresAt: "2026-10-03T12:00:00.000Z" }),
    );
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("fetch", fetch);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<LocalDevnetActivationHandoff campaignId={campaignId} canManage />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Copy signed link for/ }),
  );
  await screen.findByText(/Private test link copied/);
  expect(writeText).toHaveBeenCalledWith(url);
  expect(fetch.mock.calls[1][0]).toContain("action=readSignedLink");
  expect(fetch.mock.calls[1][0]).toContain(`contentAssetId=${assetId}`);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(
    screen.getByRole("textbox", { name: /Signed participant link/ }),
  ).toHaveValue(url);
  expect(
    screen.getByText(/Copying does not open the participant page/),
  ).toBeVisible();
  expect(screen.getByText(/Handoff expires no later than/)).toHaveTextContent(
    "30 Sept 2026, 13:00 UTC",
  );
});

it("offers a selectable link when clipboard access fails", async () => {
  const url = `http://localhost:3322/t/3aa1d656-4075-4c91-935d-cd2f510fff75?signature=${"a".repeat(43)}`;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(response(handoff("ready")))
      .mockResolvedValueOnce(
        response({ url, expiresAt: "2026-10-03T12:00:00.000Z" }),
      ),
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(async () => {
        throw Error("denied");
      }),
    },
  });
  render(<LocalDevnetActivationHandoff campaignId={campaignId} canManage />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Copy signed link for/ }),
  );
  expect(
    await screen.findByRole("textbox", {
      name: /Signed participant link · private test only/,
    }),
  ).toHaveValue(url);
});

it("rejects an already expired verified response without copying or displaying it", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(response(handoff("live")))
      .mockResolvedValueOnce(
        response({
          url: "https://proof.example/t/private?signature=signed",
          expiresAt: "2026-09-30T12:29:00.000Z",
        }),
      ),
  );
  render(<LocalDevnetActivationHandoff campaignId={campaignId} canManage />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Copy signed link for/ }),
  );
  await screen.findByText(/The signed link could not be confirmed/);
  expect(writeText).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("textbox", { name: /Signed participant link/ }),
  ).not.toBeInTheDocument();
});

it("clears a displayed link when a later retained read fails", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(handoff("ready")))
    .mockResolvedValueOnce(
      response({
        url: "https://proof.example/t/private?signature=signed",
        expiresAt: "2026-10-01T12:00:00.000Z",
      }),
    )
    .mockResolvedValueOnce({ ok: false });
  vi.stubGlobal("fetch", fetch);
  render(<LocalDevnetActivationHandoff campaignId={campaignId} canManage />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Copy signed link for/ }),
  );
  await screen.findByRole("textbox", { name: /Signed participant link/ });
  fireEvent.click(
    screen.getByRole("button", { name: /Check Retained Status/ }),
  );
  await screen.findByText(
    /The retained activation state could not be confirmed/,
  );
  expect(
    screen.queryByRole("textbox", { name: /Signed participant link/ }),
  ).not.toBeInTheDocument();
});

it("removes the manual handoff at its earliest capability deadline", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(response(handoff("live")))
      .mockResolvedValueOnce(
        response({
          url: "https://proof.example/t/private?signature=signed",
          expiresAt: "2026-10-01T12:00:00.000Z",
        }),
      ),
  );
  render(<LocalDevnetActivationHandoff campaignId={campaignId} canManage />);
  const copy = await screen.findByRole("button", {
    name: /Copy signed link for/,
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await act(async () => fireEvent.click(copy));
  expect(
    screen.getByRole("textbox", { name: /Signed participant link/ }),
  ).toBeVisible();
  await act(async () => vi.advanceTimersByTime(30 * 60 * 1000));
  expect(
    screen.queryByRole("textbox", { name: /Signed participant link/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/This participant handoff has expired/),
  ).toBeVisible();
});

it("discards clipboard completion after the capability expires", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writeText = vi.fn(() => pending);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(response(handoff("live")))
      .mockResolvedValueOnce(
        response({
          url: "https://proof.example/t/private?signature=signed",
          expiresAt: "2026-10-01T12:00:00.000Z",
        }),
      ),
  );
  render(<LocalDevnetActivationHandoff campaignId={campaignId} canManage />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Copy signed link for/ }),
  );
  await screen.findByRole("textbox", { name: /Signed participant link/ });
  vi.mocked(Date.now).mockReturnValue(Date.parse("2026-09-30T13:00:01.000Z"));
  await act(async () => release());
  expect(
    screen.queryByRole("textbox", { name: /Signed participant link/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Private test link copied/),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/The signed link could not be confirmed/),
  ).toBeVisible();
});

it.each(["pending", "error"])(
  "clears retained private state before a new %s transport can settle",
  async (state) => {
    const original = vi.fn(async (input: Record<string, unknown>) =>
      input.action === "readSignedLink"
        ? {
            url: "https://proof.example/t/private?signature=signed",
            expiresAt: "2026-10-01T12:00:00.000Z",
          }
        : handoff("live"),
    );
    const view = render(
      <LocalDevnetActivationHandoff
        campaignId={campaignId}
        canManage
        transport={original}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Copy signed link for/ }),
    );
    await screen.findByRole("textbox", { name: /Signed participant link/ });
    const replacement = async (): Promise<unknown> => {
      if (state === "error") throw new Error("New transport unavailable");
      return new Promise(() => {});
    };
    view.rerender(
      <LocalDevnetActivationHandoff
        campaignId={campaignId}
        canManage
        transport={replacement}
      />,
    );
    expect(
      screen.queryByRole("textbox", { name: /Signed participant link/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Campaign activation is recorded/),
    ).not.toBeInTheDocument();
    if (state === "pending")
      expect(
        screen.getByText(/Loading retained activation state/),
      ).toBeVisible();
    else await screen.findByText("New transport unavailable");
  },
);

it.each(["permission", "campaign", "unmount"] as const)(
  "discards a pending signed-link response after %s changes",
  async (change) => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn((url: string) =>
      url.includes("action=readSignedLink")
        ? pending
        : Promise.resolve(response(handoff("ready"))),
    );
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("fetch", fetch);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const view = render(
      <LocalDevnetActivationHandoff campaignId={campaignId} canManage />,
    );
    const copy = await screen.findByRole("button", {
      name: /Copy signed link for/,
    });
    await waitFor(() => expect(copy).toBeEnabled());
    fireEvent.click(copy);
    if (change === "unmount") view.unmount();
    else
      view.rerender(
        <LocalDevnetActivationHandoff
          campaignId={change === "campaign" ? assetId : campaignId}
          canManage={change !== "permission"}
        />,
      );
    await act(async () =>
      release(
        response({
          url: "http://localhost:3322/t/private?signature=signed",
          expiresAt: "2099-10-03T12:00:00.000Z",
        }),
      ),
    );
    expect(writeText).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("textbox", { name: /Signed participant link/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Private test link copied/),
    ).not.toBeInTheDocument();
  },
);

it("does not expose a manual link after clipboard failure follows permission loss", async () => {
  let reject!: (error: Error) => void;
  const pendingClipboard = new Promise<void>((_, fail) => {
    reject = fail;
  });
  const writeText = vi.fn(() => pendingClipboard);
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        response(
          url.includes("action=readSignedLink")
            ? {
                url: "http://localhost:3322/t/private?signature=signed",
                expiresAt: "2099-10-03T12:00:00.000Z",
              }
            : handoff("ready"),
        ),
      ),
    ),
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const view = render(
    <LocalDevnetActivationHandoff campaignId={campaignId} canManage />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: /Copy signed link for/ }),
  );
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  view.rerender(
    <LocalDevnetActivationHandoff campaignId={campaignId} canManage={false} />,
  );
  await act(async () => reject(new Error("Clipboard denied")));
  expect(
    screen.queryByRole("textbox", { name: /Signed participant link/ }),
  ).not.toBeInTheDocument();
});

it("clears an already displayed manual link when management permission is removed", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        response(
          url.includes("action=readSignedLink")
            ? {
                url: "http://localhost:3322/t/private?signature=signed",
                expiresAt: "2099-10-03T12:00:00.000Z",
              }
            : handoff("ready"),
        ),
      ),
    ),
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
  const view = render(
    <LocalDevnetActivationHandoff campaignId={campaignId} canManage />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: /Copy signed link for/ }),
  );
  await screen.findByRole("textbox", { name: /Signed participant link/ });
  view.rerender(
    <LocalDevnetActivationHandoff campaignId={campaignId} canManage={false} />,
  );
  expect(
    screen.queryByRole("textbox", { name: /Signed participant link/ }),
  ).not.toBeInTheDocument();
  view.rerender(
    <LocalDevnetActivationHandoff campaignId={campaignId} canManage />,
  );
  expect(
    screen.queryByRole("textbox", { name: /Signed participant link/ }),
  ).not.toBeInTheDocument();
});

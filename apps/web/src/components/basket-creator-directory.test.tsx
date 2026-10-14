import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { draftCustomBasket, type SavedBasketStrategy } from "@landed/contracts";
import { BasketCreatorDirectory } from "./basket-creator-directory";
import { StrategyClientError } from "@/lib/baskets/strategy-client";

const push = vi.fn();
const basketId = "90000000-0000-4000-8000-000000000001";
const oldId = "30000000-0000-4000-8000-000000000001";
const newId = "30000000-0000-4000-8000-000000000002";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./creator-directory", () => ({
  CreatorDirectory: ({
    renderBasketAction,
  }: {
    renderBasketAction: (ids: string[]) => React.ReactNode;
  }) => renderBasketAction([oldId, newId]),
}));
function setup(canManage = true) {
  const record: SavedBasketStrategy = {
    basketId,
    revision: 4,
    persistence: "saved",
    draft: draftCustomBasket({
      name: "Investor plan",
      selectedCreatorIds: [oldId],
    }),
  };
  const client = {
    load: vi.fn().mockResolvedValue(record),
    save: vi.fn(),
    addCreators: vi.fn().mockResolvedValue(5),
  };
  const mount = () =>
    render(
      <BasketCreatorDirectory
        projectId="helios"
        basketId={basketId}
        creators={[]}
        canManage={canManage}
        client={client}
      />,
    );
  return { client, record, mount };
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("BSK-08 same-basket creator selection", () => {
  it("appends only new IDs at the saved revision and returns to the same basket", async () => {
    const { client, mount } = setup();
    mount();
    const button = await screen.findByRole("button", {
      name: "Add 1 to plan",
    });
    fireEvent.click(button);
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/projects/helios/baskets/${basketId}`),
    );
    expect(client.addCreators).toHaveBeenCalledWith({
      expectedRevision: 4,
      creatorIds: [newId],
    });
    expect(client.save).not.toHaveBeenCalled();
  });
  it("keeps uncertain writes blocked until an explicit fresh review", async () => {
    const { client, record, mount } = setup();
    client.addCreators.mockRejectedValue(
      new StrategyClientError("unavailable"),
    );
    mount();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Add 1 to plan",
      }),
    );
    await screen.findByRole("alert");
    expect(push).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Add 1 to plan" }),
    ).toBeDisabled();
    client.load.mockResolvedValue({
      ...record,
      revision: 5,
      draft: { ...record.draft, selectedCreatorIds: [oldId, newId] },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Check the saved plan" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Use these saved details" }),
    );
    expect(
      screen.getByRole("button", { name: "Add 0 to plan" }),
    ).toBeDisabled();
    expect(client.addCreators).toHaveBeenCalledTimes(1);
  });
  it("does not submit for a read-only operator", async () => {
    const { client, mount } = setup(false);
    mount();
    const button = await screen.findByRole("button", {
      name: "Add 1 to plan",
    });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(client.addCreators).not.toHaveBeenCalled();
  });
  it("ignores success after leaving and prevents double submission", async () => {
    const { client, mount } = setup();
    let resolve!: (revision: number) => void;
    client.addCreators.mockReturnValue(
      new Promise<number>((done) => {
        resolve = done;
      }),
    );
    const view = mount();
    const button = await screen.findByRole("button", {
      name: "Add 1 to plan",
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(client.addCreators).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => resolve(5));
    expect(push).not.toHaveBeenCalled();
  });
  it("never adopts legacy baskets automatically", async () => {
    const { client, record, mount } = setup();
    client.load.mockResolvedValue({
      ...record,
      persistence: "legacy_unconfigured",
      revision: 0,
    });
    mount();
    expect(
      await screen.findByText(/Save Goal and audience on the plan before/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Add 1 to plan" }),
    ).toBeDisabled();
    expect(client.save).not.toHaveBeenCalled();
  });
  it("shows the plan it adds to, the way back and what will be skipped", async () => {
    const { mount } = setup();
    mount();
    const bar = await screen.findByRole("region", {
      name: "Plan you are adding to",
    });
    await waitFor(() =>
      expect(bar).toHaveTextContent(
        "Adding candidates to Investor plan · 1 already in this plan · up to 20",
      ),
    );
    expect(screen.getByRole("link", { name: /Back to plan/ })).toHaveAttribute(
      "href",
      `/projects/helios/baskets/${basketId}`,
    );
    const tray = screen.getByRole("region", { name: "Selected creators" });
    expect(tray).toHaveTextContent("1 selected");
    expect(tray).toHaveTextContent("1 already in the plan is skipped.");
    expect(tray).toHaveTextContent("Existing terms don’t change.");
  });
});

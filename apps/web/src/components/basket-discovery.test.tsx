import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BasketDiscovery } from "./basket-discovery";
import { captureDiscovery } from "@/test/capture-discovery";
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("goal-led basket discovery", () => {
  it("warns before losing unsaved custom starting details", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <BasketDiscovery
        projectId="helios"
        templateKey="custom"
        canManage
        rehearsalPath="/visual-tests/baskets/discovery"
      />,
    );
    fireEvent.change(screen.getByLabelText("Name your basket"), {
      target: { value: "Unsaved plan" },
    });
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    screen
      .getByRole("link", { name: /Explore all baskets/ })
      .dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });
  it("keeps both rehearsal entry choices in the isolated route", () => {
    render(
      <BasketDiscovery
        projectId="helios"
        canManage
        rehearsalPath="/visual-tests/baskets/discovery"
      />,
    );
    expect(
      screen.getByRole("link", { name: "Build your own" }),
    ).toHaveAttribute(
      "href",
      "/visual-tests/baskets/discovery?template=custom",
    );
    expect(
      screen.getByRole("link", { name: "Explore Investor Reach" }),
    ).toHaveAttribute(
      "href",
      "/visual-tests/baskets/discovery?template=investor_reach",
    );
  });
  it("creates a custom draft from a goal without inventing creators or a template", async () => {
    const id = "a1000000-0000-4000-8000-000000000001";
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ basketId: id }), { status: 201 }),
      );
    vi.stubGlobal("fetch", request);
    render(
      <BasketDiscovery
        projectId="helios"
        templateKey="custom"
        canManage
        rehearsalPath="/visual-tests/baskets/discovery"
      />,
    );
    fireEvent.change(screen.getByLabelText("Name your basket"), {
      target: { value: "Custom investor plan" },
    });
    fireEvent.change(
      screen.getByLabelText("What do you want to achieve? (optional)"),
      { target: { value: "Qualified registrations" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save my starting basket" }),
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/projects/helios/baskets/${id}`),
    );
    expect(JSON.parse(request.mock.calls[0]![1].body)).toEqual({
      kind: "custom",
      name: "Custom investor plan",
      goal: "Qualified registrations",
      audience: null,
    });
  });
  it("does not enable custom creation for a read-only visitor", () => {
    render(
      <BasketDiscovery
        projectId="helios"
        templateKey="custom"
        rehearsalPath="/visual-tests/baskets/discovery"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Save my starting basket" }),
    ).toBeDisabled();
  });
  it("does not redirect after leaving while a save is pending", async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const { unmount } = render(
      <BasketDiscovery
        projectId="helios"
        templateKey="investor_reach"
        canManage
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Customise this basket" }),
    );
    captureDiscovery("loading");
    unmount();
    await act(async () =>
      resolve(
        new Response(
          JSON.stringify({ basketId: "a1000000-0000-4000-8000-000000000001" }),
          { status: 201 },
        ),
      ),
    );
    expect(push).not.toHaveBeenCalled();
  });
  it("offers both entry paths and addressable strategies without creating anything", () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    render(<BasketDiscovery projectId="helios" canManage />);
    expect(
      screen.getByRole("link", { name: "Build your own" }),
    ).toHaveAttribute("href", "/projects/helios/kols");
    expect(
      screen.getByRole("link", { name: "Explore Investor Reach" }),
    ).toHaveAttribute(
      "href",
      "/projects/helios/baskets?template=investor_reach",
    );
    expect(request).not.toHaveBeenCalled();
    captureDiscovery("library");
  });
  it("explains allocation and evidence boundaries before any write", () => {
    render(
      <BasketDiscovery
        projectId="helios"
        templateKey="investor_reach"
        canManage
      />,
    );
    expect(
      screen.getByText(/Suggested share of planned spend—not reach/),
    ).toBeVisible();
    expect(screen.getAllByRole("meter")).toHaveLength(3);
    expect(screen.getByLabelText("Name your basket")).toHaveValue(
      "Investor Reach",
    );
    expect(
      screen.getByText(/No measured basket performance/),
    ).toBeInTheDocument();
    captureDiscovery("detail");
  });
  it("saves an exact-version independent draft and opens its existing builder once", async () => {
    const id = "a1000000-0000-4000-8000-000000000001";
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ basketId: id }), { status: 201 }),
      );
    vi.stubGlobal("fetch", request);
    render(
      <BasketDiscovery
        projectId="helios"
        templateKey="investor_reach"
        canManage
      />,
    );
    fireEvent.change(screen.getByLabelText("Name your basket"), {
      target: { value: "Investor autumn campaign" },
    });
    const button = screen.getByRole("button", {
      name: "Customise this basket",
    });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/projects/helios/baskets/${id}`),
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
      kind: "prepared",
      templateKey: "investor_reach",
      templateVersion: 1,
      name: "Investor autumn campaign",
    });
    expect(button).toBeDisabled();
  });
  it.each([503, 200])(
    "does not retry unconfirmed or malformed success (%s)",
    async (status) => {
      const request = vi
        .fn()
        .mockResolvedValue(
          new Response("private provider details", { status }),
        );
      vi.stubGlobal("fetch", request);
      render(
        <BasketDiscovery
          projectId="helios"
          templateKey="investor_reach"
          canManage
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Customise this basket" }),
      );
      await screen.findByRole("link", { name: "Check Continue your work" });
      expect(
        screen.getByRole("button", { name: "Customise this basket" }),
      ).toBeDisabled();
      expect(
        screen.queryByText("private provider details"),
      ).not.toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();
      expect(request).toHaveBeenCalledTimes(1);
      captureDiscovery("error");
    },
  );
  it("keeps readers read-only and unknown templates recoverable", () => {
    const { rerender } = render(
      <BasketDiscovery projectId="helios" templateKey="investor_reach" />,
    );
    expect(
      screen.getByRole("button", { name: "Customise this basket" }),
    ).toBeDisabled();
    captureDiscovery("permission");
    rerender(<BasketDiscovery projectId="helios" templateKey="missing" />);
    expect(
      screen.getByText(/That starting strategy is unavailable/),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Customise this basket" }),
    ).not.toBeInTheDocument();
    captureDiscovery("unavailable");
  });
});

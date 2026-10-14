import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CampaignAssetInputLink } from "./campaign-asset-input-link";
import { CampaignEditGuard } from "./campaign-edit-guard";

const navigation = vi.hoisted(() => ({ pathname: "", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
const campaignPath =
  "/projects/helios/campaigns/a1000000-0000-4000-8000-000000000001";
const controlId = "tracking-a5000000-0000-4000-8000-000000000001";
const link = (
  <CampaignAssetInputLink
    campaignPath={campaignPath}
    controlId={controlId}
    view="tracking"
  >
    Resolve asset
  </CampaignAssetInputLink>
);
beforeEach(() => {
  navigation.pathname = campaignPath;
  navigation.search =
    "view=content&theme=dark&executionJob=a9000000-0000-4000-8000-000000000001&executionReview=a9000000-0000-4000-8000-000000000002&demo=1&demoStep=7";
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("changes only the view and asset anchor within the same campaign", () => {
  render(link);
  const href = screen
    .getByRole("link", { name: "Resolve asset" })
    .getAttribute("href")!;
  const url = new URL(href, "https://example.test");
  expect(url.pathname).toBe(campaignPath);
  expect(url.hash).toBe(`#${controlId}`);
  const expected = new URLSearchParams(navigation.search);
  expected.set("view", "tracking");
  expect(url.searchParams.toString()).toBe(expected.toString());
});

it("does not borrow another campaign or preview's review context", () => {
  navigation.pathname = "/projects/helios/campaigns/another-campaign";
  render(link);
  expect(screen.getByRole("link")).toHaveAttribute(
    "href",
    `${campaignPath}?view=tracking#${controlId}`,
  );
});

it("replaces repeated view parameters with one destination", () => {
  navigation.search = "view=content&view=results&theme=dark";
  render(link);
  expect(screen.getByRole("link")).toHaveAttribute(
    "href",
    `${campaignPath}?view=tracking&theme=dark#${controlId}`,
  );
});

it("keeps the existing unsaved-edit guard on cross-view navigation", () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(
    <CampaignEditGuard>
      <form>
        <label>
          Brief
          <input name="brief" />
        </label>
      </form>
      {link}
    </CampaignEditGuard>,
  );
  fireEvent.change(screen.getByLabelText("Brief"), {
    target: { value: "Unsaved" },
  });
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  screen.getByRole("link").dispatchEvent(event);
  expect(confirm).toHaveBeenCalledOnce();
  expect(event.defaultPrevented).toBe(true);
});

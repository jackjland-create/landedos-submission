import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectRecordIndex } from "./project-record-index";
import { captureHandoff } from "@/test/capture-handoff";
import Loading from "@/app/projects/[projectId]/[section]/loading";
import ProjectError from "@/app/projects/[projectId]/[section]/error";

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "helios" }),
}));
vi.mock("@/lib/observability", () => ({ logError: vi.fn() }));

const records = [
  {
    id: "a1000000-0000-4000-8000-000000000001",
    name: "Mobile launch",
    updated_at: "2026-09-08T10:00:00Z",
    status: "approved" as const,
  },
  {
    id: "a1000000-0000-4000-8000-000000000002",
    name: "Founder interviews",
    updated_at: "2026-09-07T10:00:00Z",
    status: "live" as const,
  },
];
afterEach(cleanup);
describe("real record navigation", () => {
  it("retains existing loading and recoverable error boundaries", () => {
    const { unmount } = render(<Loading />);
    expect(screen.getByLabelText("Loading project data")).toBeVisible();
    captureHandoff("record-index-loading", "campaigns");
    unmount();
    const retry = vi.fn();
    render(
      <div data-testid="handoff-content">
        <ProjectError error={new Error("fixture unavailable")} reset={retry} />
      </div>,
    );
    expect(
      screen.getByText("The project view could not be prepared."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "RETRY VIEW" }));
    expect(retry).toHaveBeenCalledOnce();
    captureHandoff("record-index-error", "campaigns");
  });
  it("provides exact campaign links rather than choosing the newest", () => {
    render(
      <ProjectRecordIndex
        section="campaigns"
        projectId="helios"
        records={records}
        page={1}
        hasNext
      />,
    );
    expect(screen.getByRole("link", { name: "Mobile launch" })).toHaveAttribute(
      "href",
      `/projects/helios/campaigns/${records[0]!.id}`,
    );
    expect(
      screen.getByRole("link", { name: "Founder interviews" }),
    ).toHaveAttribute("href", `/projects/helios/campaigns/${records[1]!.id}`);
    expect(screen.getByRole("link", { name: "NEXT PAGE" })).toHaveAttribute(
      "href",
      "/projects/helios/campaigns?page=2",
    );
    expect(screen.getByRole("link", { name: "OPEN BASKETS" })).toHaveAttribute(
      "href",
      "/projects/helios/baskets",
    );
    captureHandoff("campaign-index", "campaigns");
  });
  it("offers each basket and keeps page navigation addressable", () => {
    render(
      <ProjectRecordIndex
        section="baskets"
        projectId="helios"
        records={records.map(({ status, ...item }) => {
          void status;
          return item;
        })}
        page={2}
        hasNext={false}
      />,
    );
    expect(screen.getByRole("link", { name: "Mobile launch" })).toHaveAttribute(
      "href",
      `/projects/helios/baskets/${records[0]!.id}`,
    );
    expect(screen.getByRole("link", { name: "PREVIOUS PAGE" })).toHaveAttribute(
      "href",
      "/projects/helios/baskets?page=1",
    );
    expect(
      screen.getByRole("link", { name: "CHOOSE CREATORS" }),
    ).toHaveAttribute("href", "/projects/helios/kols");
    captureHandoff("basket-index", "baskets");
  });
  it("keeps no-data, later-page emptiness and denied access distinct", () => {
    const { rerender } = render(
      <ProjectRecordIndex
        section="campaigns"
        projectId="helios"
        records={[]}
        page={1}
        hasNext={false}
      />,
    );
    expect(screen.getByText("No campaigns yet")).toBeVisible();
    captureHandoff("campaign-index-empty", "campaigns");
    rerender(
      <ProjectRecordIndex
        section="campaigns"
        projectId="helios"
        records={[]}
        page={3}
        hasNext={false}
      />,
    );
    expect(screen.getByText("No more records on this page")).toBeVisible();
    rerender(
      <ProjectRecordIndex
        section="campaigns"
        projectId="helios"
        records={[]}
        page={1}
        hasNext={false}
        denied
      />,
    );
    expect(screen.getByText("PERMISSION REQUIRED")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "OPEN BASKETS" }),
    ).not.toBeInTheDocument();
    captureHandoff("campaign-index-denied", "campaigns");
  });
});

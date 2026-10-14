import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReportVisualFixture } from "@/lib/reports/visual-fixtures";
import { parseClarityQuery } from "@/lib/reports/clarity";
import { buildCreatorEconomics } from "./performance-report";
import { ClarityReporting } from "./clarity-reporting";

vi.mock("./report-snapshot-chart", () => ({
  ReportSnapshotChart: () => <div>Trend chart</div>,
}));
vi.mock("./report-funnel-chart", () => ({
  ReportFunnelChart: () => <div>Funnel chart</div>,
}));

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  const fixture = buildReportVisualFixture("ready");
  const economics = Object.fromEntries(
    fixture.report.versions.map((version) => [
      version.version,
      buildCreatorEconomics(
        fixture.campaign,
        fixture.rankingEvidencePaths.filter(
          (path) => path.reportVersionId === version.id,
        ),
        version,
      ),
    ]),
  );
  const query =
    "?theme=light&version=2&compare=1&creator=91000000-0000-4000-8000-000000000061";
  window.history.replaceState(null, "", query);
  return {
    fixture,
    economics,
    initialQuery: parseClarityQuery(new URLSearchParams(query)),
  };
}

describe("Clarity analysis ribbon", () => {
  it("uses one working shell and preserves report selection when changing theme", () => {
    render(<ClarityReporting state="ready" {...setup()} />);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeInTheDocument();
    const before = new URLSearchParams(window.location.search);
    fireEvent.click(screen.getByRole("switch"));
    const after = new URLSearchParams(window.location.search);
    for (const key of ["version", "compare", "creator"])
      expect(after.get(key)).toBe(before.get(key));
    expect(after.get("theme")).toBe("dark");
    expect(
      document.querySelector('[data-shell-theme="dark"]'),
    ).toBeInTheDocument();
  });
  it("fails closed when an isolated issued report has no approved context", () => {
    render(
      <ClarityReporting
        state="ready"
        {...setup()}
        sourceMode="isolated-issued"
      />,
    );
    expect(
      screen.getByText("This report could not be loaded"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Trend chart")).toBeNull();
    expect(screen.queryByRole("button", { name: "Export CSV" })).toBeNull();
  });
  it("renders first issuance without fabricating a comparison, even with a stale compare URL", () => {
    const props = setup();
    props.fixture.report.versions = [props.fixture.selectedVersion];
    const original = JSON.stringify(props.fixture);
    render(<ClarityReporting state="ready" {...props} />);
    const compare = screen.getByLabelText("Comparison version");
    expect(compare).toHaveValue("");
    expect(compare).toHaveDisplayValue("No comparison");
    expect(
      screen.getByText(
        "Requested comparison V1 is unavailable for this report. No other version was substituted.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Same-campaign comparison:/)).toBeNull();
    expect(JSON.stringify(props.fixture)).toBe(original);
  });
  it("customizes and resets presentation without changing the issued data", () => {
    const props = setup();
    const original = JSON.stringify(props.fixture);
    render(<ClarityReporting state="ready" {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Customize metrics" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Activated wallets" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Move Activated wallets earlier" }),
    );
    expect(new URLSearchParams(window.location.search).get("metrics")).toBe(
      "spend,qualified,cpqw,activated,revenue",
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.change(screen.getByLabelText("Chart measures"), {
      target: { value: "activated" },
    });
    expect(new URLSearchParams(window.location.search).get("chart")).toBe(
      "activated",
    );
    fireEvent.click(screen.getByRole("button", { name: "Customize metrics" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Reset default metrics" }),
    );
    expect(new URLSearchParams(window.location.search).get("metrics")).toBe(
      "spend,qualified,cpqw,revenue",
    );
    expect(JSON.stringify(props.fixture)).toBe(original);
  });
  it("keeps content distinct from creator totals and terms behind structured detail", () => {
    render(<ClarityReporting state="ready" {...setup()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Creators & content" }));
    fireEvent.click(screen.getByRole("button", { name: "By content" }));
    expect(new URLSearchParams(window.location.search).get("group")).toBe(
      "content",
    );
    expect(
      screen.getByText(
        /Views, engagement and asset-level outcome allocation are not retained/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("table", { name: /Creator comparison/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "View DeFi After Dark terms" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("Agreed deliverables");
    expect(screen.getByRole("dialog")).toHaveTextContent("Compensation");
    expect(
      screen.getByText("Advanced retained terms").closest("details"),
    ).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("replaces the full canvas while preserving shared URL context", () => {
    render(<ClarityReporting state="ready" {...setup()} />);
    expect(screen.getByText("Trend chart")).toBeInTheDocument();
    for (const label of [
      "Funnel",
      "Creators & content",
      "Economics",
      "Evidence & history",
    ]) {
      fireEvent.click(screen.getByRole("tab", { name: label }));
      expect(screen.queryByText("Trend chart")).not.toBeInTheDocument();
      const query = new URLSearchParams(window.location.search);
      expect(query.get("version")).toBe("2");
      expect(query.get("compare")).toBe("1");
      expect(query.get("creator")).toBe("91000000-0000-4000-8000-000000000061");
    }
    fireEvent.click(screen.getByRole("tab", { name: "Performance" }));
    expect(screen.getByText("Trend chart")).toBeInTheDocument();
  });

  it("does not invent a target or a leading creator from tied outcomes", () => {
    const props = setup();
    for (const version of props.fixture.report.versions) {
      if (version.measurementContext)
        version.measurementContext.benchmarks = [];
    }
    for (const result of Object.values(props.economics)) {
      if (result) for (const row of result.creators) row.qualifiedWallets = 1;
    }
    render(<ClarityReporting state="ready" {...props} />);
    expect(
      screen.getByText(
        "Approved target: not available in this issued version.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/contributed .* qualified wallets in this snapshot/),
    ).not.toBeInTheDocument();
  });

  it("keeps real issued reports read-only and never substitutes a planning preview", () => {
    const props = setup();
    props.economics = {};
    props.fixture.rankingEvidencePaths = [];
    render(
      <ClarityReporting
        evidenceProvenance="synthetic"
        state="ready"
        {...props}
        issuedContextStatus="measurement"
        sourceMode="issued"
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Creators & content" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("link", { name: "Open Baskets" })).toHaveAttribute(
      "href",
      "/projects/helios/baskets",
    );
    expect(
      screen.getByText(/Retained creator commercial detail is unavailable/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/connected in this rehearsal/i)).toBeNull();
    expect(
      screen.getByText(/Wallet signatures and consent are simulated/),
    ).toBeInTheDocument();
  });

  it("opens an exact evidence deep link and does not borrow another version's paths", () => {
    const props = setup();
    props.fixture.rankingEvidencePaths = [];
    const query =
      "?version=2&view=evidence&evidence=qualified_wallets&theme=light";
    window.history.replaceState(null, "", query);
    render(
      <ClarityReporting
        evidenceProvenance="unknown"
        state="ready"
        {...props}
        initialQuery={parseClarityQuery(new URLSearchParams(query))}
        issuedContextStatus="measurement"
        sourceMode="issued"
      />,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "No exact outcome paths are retained for this version and filter.",
    );
    expect(screen.getByRole("dialog")).not.toHaveTextContent("rehearsal");
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Exact outcome provenance is unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(new URLSearchParams(window.location.search).has("evidence")).toBe(
      false,
    );
  });

  it("labels the demo walkthrough without inventing replay outcome evidence or cost context", () => {
    const props = setup();
    props.fixture.rankingEvidencePaths = [];
    const query = "?version=2&view=evidence&theme=light";
    window.history.replaceState(null, "", query);
    let exported = "";
    vi.stubGlobal(
      "Blob",
      class {
        constructor(parts: string[]) {
          exported = parts.join("");
        }
      },
    );
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL() {
          return "blob:test-export";
        }
        static revokeObjectURL() {}
      },
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(
      <ClarityReporting
        {...props}
        state="ready"
        sourceMode="issued"
        syntheticDemoContext
        fixture={{
          ...props.fixture,
          selectedVersion: {
            ...props.fixture.selectedVersion,
            measurementContext: null,
          },
        }}
        evidenceProvenance="unknown"
        issuedContextStatus="metric_snapshot_only"
        initialQuery={parseClarityQuery(new URLSearchParams(query))}
      />,
    );
    expect(screen.getByText(/Synthetic demo walkthrough/)).toHaveTextContent(
      "Exact outcome provenance unavailable",
    );
    expect(
      screen.queryByText(/Wallet signatures and consent are simulated/),
    ).toBeNull();
    expect(
      screen.getByText(
        "Retained schedule and contracted-cost detail unavailable",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", {
        name: "Retained report context availability",
      }),
    ).toHaveTextContent("Not retained for this issued version");
    expect(
      screen.getByRole("button", { name: "Open evidence paths (0)" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(exported).toContain("synthetic demo walkthrough");
    expect(exported).toContain("exact outcome provenance unavailable");
    expect(exported).toContain(
      "schedule and contracted-cost detail unavailable",
    );
    expect(exported).not.toContain("signatures and consent simulated");
  });
});

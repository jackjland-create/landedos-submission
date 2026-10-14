import { describe, expect, it } from "vitest";

import {
  guidedDemoSteps,
  guidedDemoTotalSeconds,
  withGuidedDemo,
} from "./guided-demo";
import { guidedDemoManifest } from "./guided-demo-manifest";

describe("guided demo contract", () => {
  it("defines the complete deterministic journey in under eight minutes", () => {
    expect(guidedDemoSteps).toHaveLength(12);
    expect(new Set(guidedDemoSteps.map((step) => step.id)).size).toBe(12);
    expect(guidedDemoSteps.map((step) => step.index)).toEqual(
      Array.from({ length: 12 }, (_, index) =>
        String(index + 1).padStart(2, "0"),
      ),
    );
    expect(guidedDemoTotalSeconds).toBeLessThanOrEqual(8 * 60);
  });

  it("gives every step a reason, readiness state, evidence and outcome", () => {
    for (const step of guidedDemoSteps) {
      expect(step.why).not.toHaveLength(0);
      expect(step.readiness).not.toHaveLength(0);
      expect(step.evidence).not.toHaveLength(0);
      expect(step.success).not.toHaveLength(0);
      expect(step.next).not.toHaveLength(0);
      expect(step.actionLabel).not.toHaveLength(0);
      expect(step.path("helios")).toMatch(/^\/projects\/helios\//);
    }
  });

  it("keeps sensitive wallet requests out of the management journey", () => {
    const copy = JSON.stringify(guidedDemoSteps).toLowerCase();
    expect(copy).not.toContain("seed phrase");
    expect(copy).not.toContain("private key");
  });

  it("pins commercial steps to the canonical basket and resolves one campaign manifest", () => {
    expect(guidedDemoSteps[2]!.path("helios")).toBe(
      `/projects/helios/baskets/${guidedDemoManifest.basketId}`,
    );
    expect(guidedDemoSteps[3]!.path("helios")).toBe(
      `/projects/helios/baskets/${guidedDemoManifest.basketId}#commercial-approval`,
    );
    expect(guidedDemoSteps[3]!.readiness).toContain(
      guidedDemoManifest.blockerPackageName,
    );
    expect(guidedDemoSteps[4]!.path("helios")).toBe(
      "/projects/helios/guided-demo/campaign?view=workspace",
    );
    expect(guidedDemoSteps[5]!.path("helios")).toBe(
      "/projects/helios/guided-demo/campaign?view=content-assets",
    );
    expect(guidedDemoSteps[6]!.path("helios")).toBe(
      "/projects/helios/guided-demo/campaign?view=tracking",
    );
  });

  it("adds guided mode without losing query strings or fragments", () => {
    expect(
      withGuidedDemo("/projects/helios/reports/report-1?version=6#evidence", 9),
    ).toBe(
      "/projects/helios/reports/report-1?version=6&demo=1&demoStep=9&demoOpen=0#evidence",
    );
    expect(
      withGuidedDemo(
        "/projects/helios/baskets#commercial-approval",
        "complete",
      ),
    ).toBe(
      "/projects/helios/baskets?demo=1&demoComplete=1&demoOpen=0#commercial-approval",
    );
  });

  it("pins measured and replay comparison destinations to immutable versions", () => {
    expect(guidedDemoSteps[10]!.path("helios")).toBe(
      `/projects/helios/reports/${guidedDemoManifest.reportId}?version=2`,
    );
    expect(guidedDemoSteps[11]!.path("helios")).toBe(
      `/projects/helios/reports/${guidedDemoManifest.reportId}?version=3&compare=2`,
    );
    expect(guidedDemoSteps[11]!.readiness).toContain(
      "does not approve or run another replay",
    );
  });

  it("replaces stale guide parameters while retaining exact report and evidence", () => {
    const resumed = withGuidedDemo(
      "/projects/helios/reports/exact?version=2&demo=1&demoStep=1&demoStep=2&demoComplete=1#evidence",
      11,
    );
    expect(resumed).toBe(
      "/projects/helios/reports/exact?version=2&demo=1&demoStep=11&demoOpen=0#evidence",
    );
    expect(withGuidedDemo(resumed, 11)).toBe(resumed);
    expect(withGuidedDemo(resumed, "complete")).not.toContain("demoStep");
  });
});

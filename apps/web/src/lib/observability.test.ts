import { describe, expect, it, vi } from "vitest";

import { logError } from "./observability";

describe("structured error logging", () => {
  it("includes project, campaign and correlation identifiers", () => {
    const sink = vi.fn();
    const correlationId = logError(
      {
        event: "project_view_failed",
        error: new Error("fixture failure"),
        projectId: "helios",
        campaignId: "a1000000-0000-4000-8000-000000000001",
        correlationId: "corr_fixture_01",
      },
      sink,
    );

    expect(correlationId).toBe("corr_fixture_01");
    expect(sink).toHaveBeenCalledOnce();
    expect(JSON.parse(sink.mock.calls[0][0])).toMatchObject({
      level: "error",
      event: "project_view_failed",
      projectId: "helios",
      campaignId: "a1000000-0000-4000-8000-000000000001",
      correlationId: "corr_fixture_01",
      error: {
        name: "Error",
        message: "fixture failure",
      },
    });
  });
});

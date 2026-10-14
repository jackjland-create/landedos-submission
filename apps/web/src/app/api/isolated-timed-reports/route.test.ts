// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ gate: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/reports/timed-report-runtime.server", () => ({
  assertTimedRuntimeEnvironment: mocks.gate,
}));
vi.mock("@/lib/reports/timed-report-workflow.server", () => ({
  runTimedReportWorkflow: mocks.run,
}));
import { GET, POST } from "./route";
const origin = "http://127.0.0.1:3212";
function post(input: unknown, source = origin) {
  return new NextRequest(`${origin}/api/isolated-timed-reports`, {
    method: "POST",
    headers: {
      host: "127.0.0.1:3212",
      origin: source,
      "content-type": "application/json",
      "sec-fetch-site": source === origin ? "same-origin" : "cross-site",
    },
    body: JSON.stringify(input),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate.mockImplementation(() => undefined);
  mocks.run.mockResolvedValue({ kind: "receipt", receipt: null });
});
describe("isolated report HTTP boundary", () => {
  it("denies cross-origin writes before client work", async () => {
    expect(
      (await POST(post({ action: "confirm" }, "https://outsider.test"))).status,
    ).toBe(403);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("cannot execute writes through GET", async () => {
    expect(
      (
        await GET(
          new NextRequest(
            `${origin}/api/isolated-timed-reports?action=confirm`,
          ),
        )
      ).status,
    ).toBe(409);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("gates unavailable environments before request parsing", async () => {
    mocks.gate.mockImplementation(() => {
      throw new Error("disabled");
    });
    expect((await POST(post({ action: "prepare" }))).status).toBe(404);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("returns safe error without source or driver details", async () => {
    mocks.run.mockRejectedValue(new Error("secret database payload"));
    const response = await POST(post({ action: "confirm" }));
    const body = JSON.stringify(await response.json());
    expect(response.status).toBe(409);
    expect(body).not.toContain("secret");
    expect(body).toContain("status before trying again");
  });
  it("does not cache successful private reads", async () => {
    const response = await GET(
      new NextRequest(`${origin}/api/isolated-timed-reports?action=recover`),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.status).toBe(200);
  });
});

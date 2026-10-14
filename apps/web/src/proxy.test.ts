import { NextRequest, NextResponse } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
const { updateSession } = vi.hoisted(() => ({
  updateSession: vi.fn(async () => NextResponse.next()),
}));
vi.mock("@/lib/supabase/proxy", () => ({ updateSession }));
import { proxy } from "./proxy";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("blocks tracking GETs and application writes before they reach handlers in snapshot mode", async () => {
  vi.stubEnv("LANDED_SUBMISSION_SNAPSHOT", "1");
  for (const [path, method] of [
    ["/t/synthetic", "GET"],
    ["/t/synthetic", "HEAD"],
    ["/api/projects/example", "POST"],
    ["/projects/demo/campaigns/example", "POST"],
  ]) {
    expect(
      (await proxy(new NextRequest(`https://example.test${path}`, { method })))
        .status,
    ).toBe(403);
  }
  expect(updateSession).not.toHaveBeenCalled();
});
it("keeps ordinary reads authenticated and normal product mode unaffected", async () => {
  vi.stubEnv("LANDED_SUBMISSION_SNAPSHOT", "1");
  await proxy(new NextRequest("https://example.test/projects/demo/overview"));
  expect(updateSession).toHaveBeenCalledOnce();
  vi.stubEnv("LANDED_SUBMISSION_SNAPSHOT", "0");
  await proxy(new NextRequest("https://example.test/t/example"));
  expect(updateSession).toHaveBeenCalledTimes(2);
});

it("scopes neutral entry redirects to snapshot mode", async () => {
  vi.stubEnv("LANDED_SUBMISSION_SNAPSHOT", "1");
  const request = new NextRequest(
    "https://example.test/projects/helios/overview",
  );
  expect((await proxy(request)).headers.get("location")).toBe(
    "https://example.test/projects/demo/overview",
  );
  expect(updateSession).not.toHaveBeenCalled();
  vi.stubEnv("LANDED_SUBMISSION_SNAPSHOT", "0");
  await proxy(request);
  expect(updateSession).toHaveBeenCalledOnce();
});

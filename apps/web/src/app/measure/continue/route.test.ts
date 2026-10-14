import { beforeEach, describe, expect, it, vi } from "vitest";
const { onward, client, logger } = vi.hoisted(() => ({
  onward: vi.fn(),
  client: {},
  logger: vi.fn(),
}));
vi.mock("@/lib/wallet/continuation.server", () => ({
  readHostedContinuation: onward,
}));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => client }));
vi.mock("@/lib/tracking/signing.server", () => ({
  getTrackedLinkApplicationOrigin: () => "https://landed.example",
}));
vi.mock("@/lib/observability", () => ({ logError: logger }));
import { GET, HEAD } from "./route";
const sessionId = "a1000000-0000-4000-8000-000000000006";
function request(query = "", cookie = `lnd_session=${sessionId}`) {
  return new Request(`https://landed.example/measure/continue${query}`, {
    headers: { cookie },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  onward.mockResolvedValue({
    url: "https://brand.example/start",
    hostname: "brand.example",
  });
});
describe("hosted continuation route", () => {
  it("rechecks the cookie-bound destination and redirects without identifiers or cookies", async () => {
    const response = await GET(request());
    expect(onward).toHaveBeenCalledWith(
      client,
      sessionId,
      "https://landed.example",
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://brand.example/start",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it.each([
    "?return=https://evil.example",
    "?destination=https://evil.example",
    `?session=${sessionId}`,
  ])("rejects query-controlled continuation %s", async (query) => {
    expect((await GET(request(query))).status).toBe(410);
    expect(onward).not.toHaveBeenCalled();
  });
  it.each(["", "lnd_session=invalid"])(
    "does not resolve an absent or invalid session cookie",
    async (cookie) => {
      expect((await GET(request("", cookie))).status).toBe(410);
      expect(onward).not.toHaveBeenCalled();
    },
  );
  it("fails closed when the link is no longer available", async () => {
    onward.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(410);
    expect(response.headers.get("location")).toBeNull();
  });
  it("logs a failed read without disclosing private details in the response", async () => {
    onward.mockRejectedValue(new Error("private diagnostic"));
    const response = await GET(request());
    expect(response.status).toBe(410);
    expect(await response.text()).not.toContain("private diagnostic");
    expect(logger).toHaveBeenCalledOnce();
  });
  it("does not resolve or redirect HEAD probes", async () => {
    expect((await HEAD()).status).toBe(204);
    expect(onward).not.toHaveBeenCalled();
  });
});

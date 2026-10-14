import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { devnetReviewRequestAllowed } from "./devnet-review-lock.server";
const campaign = "00000000-0000-4000-8000-000000000001";
function allowed(
  path: string,
  method = "GET",
  mode = "review",
  host = "localhost:3319",
) {
  return devnetReviewRequestAllowed(
    new NextRequest(`http://${host}${path}`, { method, headers: { host } }),
    {
      NODE_ENV: "test",
      LANDED_LOCAL_DEVNET_INPUT_LOCK: mode,
      LANDED_LOCAL_DEVNET_REVIEW_CAMPAIGN_ID: campaign,
    },
  );
}
describe("temporary closed-input review boundary", () => {
  it("leaves the ordinary application unchanged without opt-in", () =>
    expect(allowed("/api/wallet/proofs", "POST", "")).toBe(true));
  it("permits only the acquisition kernel during drain", () => {
    expect(allowed("/api/projects/helios/campaigns", "POST", "drain")).toBe(
      false,
    );
    expect(allowed("/api/inngest", "POST", "drain")).toBe(true);
    expect(allowed("/api/inngest", "PUT", "drain")).toBe(true);
    expect(allowed("/isolated-readiness", "GET", "drain")).toBe(true);
    expect(
      allowed(`/projects/helios/campaigns/${campaign}`, "GET", "drain"),
    ).toBe(false);
  });
  it.each([
    "/measure",
    "/t/00000000-0000-4000-8000-000000000001",
    "/api/wallet/proofs",
    "/api/wallet/consents",
    "/api/integrations/helius",
    "/api/inngest",
    "/projects/helios/settings/conversions",
    "/projects/helios/baskets",
    "/api/projects/helios/campaigns",
  ])("keeps input route %s closed during review", (path) => {
    expect(allowed(path)).toBe(false);
    expect(allowed(path, "POST")).toBe(false);
  });
  it("permits exact campaign/report reads and the separately guarded review APIs", () => {
    expect(
      allowed(
        `/projects/helios/campaigns/${campaign}?executionJob=${campaign}`,
      ),
    ).toBe(true);
    expect(allowed(`/projects/helios/campaigns/${campaign}`, "POST")).toBe(
      false,
    );
    expect(allowed("/api/isolated-devnet-rehearsal", "POST")).toBe(true);
    expect(allowed("/api/isolated-timed-reports", "POST")).toBe(true);
    expect(allowed("/login", "POST")).toBe(true);
    expect(allowed("/login", "PUT")).toBe(false);
    expect(allowed("/visual-tests/reporting-studio/review")).toBe(true);
    expect(allowed(`/projects/helios/reports/${campaign}`)).toBe(true);
    expect(
      allowed(
        `/api/projects/20000000-0000-4000-8000-000000000001/reports/${campaign}/evidence`,
      ),
    ).toBe(true);
  });
  it("rejects other campaigns, host/port switches and unknown modes", () => {
    expect(
      allowed(
        "/projects/helios/campaigns/00000000-0000-4000-8000-000000000002",
      ),
    ).toBe(false);
    expect(allowed("/login", "GET", "unknown")).toBe(false);
    expect(allowed("/login", "GET", "review", "localhost:3320")).toBe(false);
    expect(allowed("/login", "GET", "review", "test.trycloudflare.com")).toBe(
      false,
    );
  });
  it("opens Overview only for local read-only review, never reopening inputs", () => {
    const path = `/projects/helios/overview?report=${campaign}&version=3&theme=dark`;
    for (const method of ["GET", "HEAD"])
      expect(allowed(path, method)).toBe(true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"])
      expect(allowed(path, method)).toBe(false);
    for (const mode of ["drain", "unknown"])
      expect(allowed(path, "GET", mode)).toBe(false);
    for (const host of ["localhost:3320", "test.trycloudflare.com"])
      expect(allowed(path, "GET", "review", host)).toBe(false);
    expect(
      devnetReviewRequestAllowed(
        new NextRequest(`http://localhost:3319${path}`, {
          headers: { host: "localhost:3319", "cf-ray": "blocked" },
        }),
        {
          NODE_ENV: "test",
          LANDED_LOCAL_DEVNET_INPUT_LOCK: "review",
          LANDED_LOCAL_DEVNET_REVIEW_CAMPAIGN_ID: campaign,
        },
      ),
    ).toBe(false);
  });
  it("rejects externally forwarded review requests", () =>
    expect(
      devnetReviewRequestAllowed(
        new NextRequest("http://localhost:3319/login", {
          headers: { host: "localhost:3319", "cf-ray": "blocked" },
        }),
        { NODE_ENV: "test", LANDED_LOCAL_DEVNET_INPUT_LOCK: "review" },
      ),
    ).toBe(false));
  it.each([undefined, "malformed", "00000000-0000-4000-8000-00000000000g"])(
    "fails closed for partially configured review scope: %s",
    (id) => {
      for (const path of [
        "/login",
        "/api/isolated-timed-reports",
        "/api/isolated-devnet-rehearsal",
        "/projects/helios/overview",
      ])
        expect(
          devnetReviewRequestAllowed(
            new NextRequest(`http://localhost:3319${path}`, {
              headers: { host: "localhost:3319" },
            }),
            {
              NODE_ENV: "test",
              LANDED_LOCAL_DEVNET_INPUT_LOCK: "review",
              LANDED_LOCAL_DEVNET_REVIEW_CAMPAIGN_ID: id,
            },
          ),
        ).toBe(false);
    },
  );
});

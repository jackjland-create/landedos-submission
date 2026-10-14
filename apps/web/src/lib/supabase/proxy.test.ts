import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerClientMock, getClaimsMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
  getClaimsMock: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}));

import { updateSession } from "./proxy";

describe("authentication proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    createServerClientMock.mockReturnValue({
      auth: { getClaims: getClaimsMock },
    });
    getClaimsMock.mockResolvedValue({ data: { claims: null }, error: null });
  });

  it("exposes only sanitized reporting fixtures when explicitly enabled", async () => {
    vi.stubEnv("ENABLE_VISUAL_FIXTURES", "1");
    const response = await updateSession(
      new NextRequest(
        "https://landed.example.test/visual-tests/reporting/ready",
      ),
    );

    expect(response.status).toBe(200);
    expect(createServerClientMock).not.toHaveBeenCalled();

    vi.stubEnv("ENABLE_VISUAL_FIXTURES", "0");
    const protectedResponse = await updateSession(
      new NextRequest(
        "https://landed.example.test/visual-tests/reporting/ready",
      ),
    );
    expect(protectedResponse.status).toBe(307);
    expect(createServerClientMock).toHaveBeenCalledOnce();
  });

  it("exposes the sanitized Landed Studio fixture when explicitly enabled", async () => {
    vi.stubEnv("ENABLE_VISUAL_FIXTURES", "1");
    const response = await updateSession(
      new NextRequest(
        "https://landed.example.test/visual-tests/reporting-studio/ready?theme=light",
      ),
    );

    expect(response.status).toBe(200);
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it("exposes sanitized pilot readiness fixtures when explicitly enabled", async () => {
    vi.stubEnv("ENABLE_VISUAL_FIXTURES", "1");
    const response = await updateSession(
      new NextRequest(
        "https://landed.example.test/visual-tests/readiness/blocked",
      ),
    );

    expect(response.status).toBe(200);
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it("exposes the sanitized wallet consent review when explicitly enabled", async () => {
    vi.stubEnv("ENABLE_VISUAL_FIXTURES", "1");
    const response = await updateSession(
      new NextRequest(
        "https://landed.example.test/visual-tests/wallet-consent/ready?theme=light",
      ),
    );

    expect(response.status).toBe(200);
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it("exposes the connected wallet measurement fixture only when enabled", async () => {
    vi.stubEnv("ENABLE_VISUAL_FIXTURES", "1");
    const response = await updateSession(
      new NextRequest(
        "https://landed.example.test/visual-tests/wallet-measurement",
      ),
    );

    expect(response.status).toBe(200);
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it("exposes the campaign workspace fixture only when enabled", async () => {
    vi.stubEnv("ENABLE_VISUAL_FIXTURES", "1");
    const response = await updateSession(
      new NextRequest(
        "https://landed.example.test/visual-tests/campaign-workspace",
      ),
    );

    expect(response.status).toBe(200);
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it("allows only local development reads of the campaign frame preview", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    for (const method of ["GET", "HEAD"]) {
      const response = await updateSession(
        new NextRequest("http://localhost:3319/visual-tests/campaign-frame", {
          method,
        }),
      );
      expect(response.status).toBe(200);
    }
    expect(createServerClientMock).not.toHaveBeenCalled();
    const write = await updateSession(
      new NextRequest("http://localhost:3319/visual-tests/campaign-frame", {
        method: "POST",
      }),
    );
    expect(write.status).toBe(307);
  });

  it.each(["production", "test", "hosted-development"])(
    "keeps frame preview protected in %s even with fixture flags",
    async (mode) => {
      vi.stubEnv(
        "NODE_ENV",
        mode === "hosted-development" ? "development" : mode,
      );
      vi.stubEnv("VERCEL", mode === "hosted-development" ? "1" : "");
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("ENABLE_VISUAL_FIXTURES", "1");
      const response = await updateSession(
        new NextRequest(
          "https://landed.example.test/visual-tests/campaign-frame",
        ),
      );
      expect(response.status).toBe(307);
      expect(createServerClientMock).toHaveBeenCalledOnce();
    },
  );

  it("exposes only the synthetic guided basket fixture when enabled", async () => {
    vi.stubEnv("ENABLE_VISUAL_FIXTURES", "1");
    const response = await updateSession(
      new NextRequest(
        "https://landed.example.test/visual-tests/baskets/guided-flow?state=ready",
      ),
    );

    expect(response.status).toBe(200);
    expect(createServerClientMock).not.toHaveBeenCalled();

    const protectedFixture = await updateSession(
      new NextRequest(
        "https://landed.example.test/visual-tests/baskets/approval",
      ),
    );
    expect(protectedFixture.status).toBe(307);
    expect(createServerClientMock).toHaveBeenCalledOnce();
  });

  it("leaves public tracked-link redirects outside the login boundary", async () => {
    const response = await updateSession(
      new NextRequest(
        "https://landed.example.test/t/d1000000-0000-4000-8000-000000000001?signature=signed",
      ),
    );

    expect(response.status).toBe(200);
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it("keeps only the participant wallet journey outside operator login", async () => {
    for (const path of [
      "/measure",
      "/api/wallet/challenges",
      "/api/wallet/proofs",
      "/api/wallet/consents",
      "/api/wallet/mappings/f2000000-0000-4000-8000-000000000001",
    ]) {
      expect(
        (
          await updateSession(
            new NextRequest(`https://landed.example.test${path}`),
          )
        ).status,
      ).toBe(200);
    }
    expect(createServerClientMock).not.toHaveBeenCalled();

    const untrusted = await updateSession(
      new NextRequest("https://landed.example.test/api/wallet/admin"),
    );
    expect(untrusted.status).toBe(307);
    expect(createServerClientMock).toHaveBeenCalledOnce();
  });

  it("leaves the provider-authenticated Helius callback outside login", async () => {
    const response = await updateSession(
      new NextRequest("https://landed.example.test/api/integrations/helius", {
        method: "POST",
        headers: { Authorization: "provider-authentication" },
      }),
    );

    expect(response.status).toBe(200);
    expect(createServerClientMock).not.toHaveBeenCalled();

    const nested = await updateSession(
      new NextRequest(
        "https://landed.example.test/api/integrations/helius/untrusted",
      ),
    );
    expect(nested.status).toBe(307);
    expect(createServerClientMock).toHaveBeenCalledOnce();
  });

  it("leaves only the exact Inngest signed execution endpoint outside login", async () => {
    const response = await updateSession(
      new NextRequest("https://landed.example.test/api/inngest", {
        method: "POST",
        headers: { Authorization: "Bearer signed-inngest-request" },
      }),
    );

    expect(response.status).toBe(200);
    expect(createServerClientMock).not.toHaveBeenCalled();

    const nested = await updateSession(
      new NextRequest("https://landed.example.test/api/inngest/untrusted"),
    );
    expect(nested.status).toBe(307);
    expect(createServerClientMock).toHaveBeenCalledOnce();
  });

  it("leaves only the exact trusted health endpoint outside login", async () => {
    const response = await updateSession(
      new NextRequest(
        "https://landed.example.test/api/internal/integrations/helius/health",
        { method: "POST", headers: { Authorization: "monitor-token" } },
      ),
    );

    expect(response.status).toBe(200);
    expect(createServerClientMock).not.toHaveBeenCalled();

    const nested = await updateSession(
      new NextRequest(
        "https://landed.example.test/api/internal/integrations/helius/health/untrusted",
      ),
    );
    expect(nested.status).toBe(307);
    expect(createServerClientMock).toHaveBeenCalledOnce();
  });

  it("limits the temporary Cloudflare devnet origin to the participant and provider paths", async () => {
    vi.stubEnv("EXTERNAL_DEVNET_PUBLIC_GATE", "1");
    const throughCloudflare = { "cf-ray": "temporary-run-edge-request" };

    for (const [method, path] of [
      ["GET", "/t/d1000000-0000-4000-8000-000000000001"],
      ["GET", "/measure"],
      ["POST", "/api/wallet/challenges"],
      ["POST", "/api/wallet/proofs"],
      ["GET", "/api/wallet/consents"],
      ["POST", "/api/wallet/consents"],
      ["DELETE", "/api/wallet/mappings/f2000000-0000-4000-8000-000000000001"],
      ["POST", "/api/integrations/helius"],
    ] as const) {
      const response = await updateSession(
        new NextRequest(`https://temporary.trycloudflare.com${path}`, {
          method,
          headers: throughCloudflare,
        }),
      );
      expect(response.status, `${method} ${path}`).toBe(200);
    }

    for (const [method, path] of [
      ["POST", "/measure"],
      ["GET", "/api/integrations/helius"],
      ["POST", "/api/inngest"],
      ["POST", "/api/projects/helios/campaigns"],
      ["POST", "/api/internal/integrations/helius/health"],
      ["GET", "/projects/helios/overview"],
      ["GET", "/visual-tests/wallet-measurement"],
      ["GET", "/login"],
    ] as const) {
      const response = await updateSession(
        new NextRequest(`https://temporary.trycloudflare.com${path}`, {
          method,
          headers: throughCloudflare,
        }),
      );
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    }

    const localInngest = await updateSession(
      new NextRequest("http://127.0.0.1:3210/api/inngest", {
        method: "POST",
      }),
    );
    expect(localInngest.status).toBe(200);
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it("keeps unauthenticated product routes behind login", async () => {
    const response = await updateSession(
      new NextRequest("https://landed.example.test/projects/helios/overview"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://landed.example.test/login?next=%2Fprojects%2Fhelios%2Foverview",
    );
    expect(createServerClientMock).toHaveBeenCalledOnce();
  });

  it("does not misrepresent a temporary authentication failure as logout", async () => {
    getClaimsMock.mockResolvedValue({
      data: null,
      error: new Error("temporary provider failure"),
    });

    const response = await updateSession(
      new NextRequest("https://landed.example.test/projects/helios/overview"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, no-store, must-revalidate, max-age=0",
    );
    expect(await response.text()).toBe(
      "Authentication service temporarily unavailable.",
    );
  });

  it("uses an explicit preview cookie namespace when configured", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_LANDED_REHEARSAL_COOKIE_DEADLINE_MS",
      String(Date.now() + 300_000),
    );
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME",
      "landed-external-session-a",
    );
    getClaimsMock.mockResolvedValue({
      data: { claims: { sub: "admin" } },
      error: null,
    });

    const response = await updateSession(
      new NextRequest(
        "http://localhost:3319/projects/helios/settings/conversions",
      ),
    );

    expect(response.status).toBe(200);
    expect(createServerClientMock).toHaveBeenCalledWith(
      undefined,
      undefined,
      expect.objectContaining({
        cookieOptions: { name: "landed-external-session-a" },
      }),
    );
  });

  it("retains the protected basket view without accepting an external return", async () => {
    const response = await updateSession(
      new NextRequest(
        "https://landed.example.test/projects/helios/baskets/basket-id?view=approval&next=https://attacker.example",
      ),
    );
    const location = new URL(response.headers.get("location")!);

    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(
      "/projects/helios/baskets/basket-id?view=approval&next=https://attacker.example",
    );
    expect(location.origin).toBe("https://landed.example.test");
  });
});

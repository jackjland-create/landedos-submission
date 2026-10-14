import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createDedupeTokenMock,
  createAdminClientMock,
  getKeyringMock,
  hashDedupeTokenMock,
  getSessionMaxAgeMock,
  isAutomatedAgentMock,
  logErrorMock,
  maybeSingleMock,
  readDedupeTokenMock,
  rpcMock,
  verifySignatureMock,
} = vi.hoisted(() => ({
  createDedupeTokenMock: vi.fn(() => "d".repeat(43)),
  createAdminClientMock: vi.fn(),
  getKeyringMock: vi.fn(() => ({ activeKeyVersion: 1, keys: new Map() })),
  hashDedupeTokenMock: vi.fn(async () => "f".repeat(64)),
  getSessionMaxAgeMock: vi.fn(() => 604800),
  isAutomatedAgentMock: vi.fn(() => false),
  logErrorMock: vi.fn(() => "corr_redirect_test"),
  maybeSingleMock: vi.fn(),
  readDedupeTokenMock: vi.fn<() => string | null>(() => null),
  rpcMock: vi.fn(),
  verifySignatureMock: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({ logError: logErrorMock }));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: createAdminClientMock,
  SupabaseServerConfigError: class SupabaseServerConfigError extends Error {},
}));
vi.mock("@/lib/tracking/quality.server", () => ({
  createTrackedClickDedupeToken: createDedupeTokenMock,
  hashTrackedClickDedupeToken: hashDedupeTokenMock,
  isDeclaredAutomatedAgent: isAutomatedAgentMock,
  readTrackedClickDedupeToken: readDedupeTokenMock,
  trackedClickAutomatedAgentPolicyVersion: 1,
  trackedClickDedupeCookieName: "lnd_click_dedupe",
  trackedClickDedupeMaxAgeSeconds: 1800,
}));
vi.mock("@/lib/tracking/signing.server", () => ({
  getTrackedLinkKeyring: getKeyringMock,
  TrackedLinkSigningConfigError: class TrackedLinkSigningConfigError extends Error {},
  verifyTrackedLinkSignature: verifySignatureMock,
}));
vi.mock("@/lib/tracking/session.server", () => ({
  anonymousSessionCookieName: "lnd_session",
  getAnonymousSessionCookieMaxAge: getSessionMaxAgeMock,
}));

import { GET, HEAD } from "./route";

const linkId = "d1000000-0000-4000-8000-000000000001";
const clickId = "e1000000-0000-4000-8000-000000000001";
const sessionId = "f1000000-0000-4000-8000-000000000001";
const signature = "a".repeat(43);
const linkRow = {
  id: linkId,
  project_id: "20000000-0000-4000-8000-000000000001",
  campaign_id: "a1000000-0000-4000-8000-000000000001",
  creator_id: "40000000-0000-4000-8000-000000000001",
  content_asset_id: "a5000000-0000-4000-8000-000000000001",
  destination_url:
    "https://helios.example.test/start?utm_source=kol&lnd_click=untrusted",
  expires_at: "2026-09-10T12:00:00.000+00:00",
  key_version: 1,
};

function request(selectedSignature = signature) {
  return new Request(
    `https://landed.example.test/t/${linkId}?signature=${selectedSignature}`,
  );
}

function context(selectedLinkId = linkId) {
  return { params: Promise.resolve({ linkId: selectedLinkId }) };
}

function clickResult(
  eligibility:
    | "eligible"
    | "invalid_signature"
    | "revoked"
    | "expired"
    | "destination_not_approved"
    | "rate_limited",
) {
  const qualityOutcome = eligibility === "eligible" ? "qualified" : "rejected";

  return [
    {
      click_id: clickId,
      eligibility,
      destination_url: linkRow.destination_url,
      requested_at: "2026-08-10T16:00:00.000+00:00",
      quality_outcome: qualityOutcome,
      session_id: eligibility === "eligible" ? sessionId : null,
      session_expires_at:
        eligibility === "eligible" ? "2026-08-17T16:00:00.000+00:00" : null,
      session_was_created: eligibility === "eligible",
    },
  ];
}

describe("public tracked-link redirect", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(clickId);
    readDedupeTokenMock.mockReturnValue(null);
    isAutomatedAgentMock.mockReturnValue(false);
    hashDedupeTokenMock.mockResolvedValue("f".repeat(64));
    maybeSingleMock.mockResolvedValue({ data: linkRow, error: null });
    verifySignatureMock.mockResolvedValue(true);
    rpcMock.mockResolvedValue({ data: clickResult("eligible"), error: null });
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: maybeSingleMock })),
        })),
      })),
      rpc: rpcMock,
    });
  });

  it("does not record unfurl and availability probes as clicks", async () => {
    const response = await HEAD();

    expect(response.status).toBe(204);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("records an eligible click and forwards its server-created identity", async () => {
    const response = await GET(request(), context());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://helios.example.test/start?utm_source=kol&lnd_click=${clickId}`,
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(verifySignatureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        linkId,
        campaignId: linkRow.campaign_id,
        creatorId: linkRow.creator_id,
        contentAssetId: linkRow.content_asset_id,
      }),
      signature,
      expect.anything(),
    );
    expect(rpcMock).toHaveBeenCalledWith("record_tracked_link_click_v3", {
      target_automated_agent_detected: false,
      target_automated_agent_policy_version: 1,
      target_click_id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      target_dedupe_key_hash: "f".repeat(64),
      target_link_id: linkId,
      target_signature_valid: true,
    });
    expect(response.headers.get("set-cookie")).toContain(
      "lnd_click_dedupe=" + "d".repeat(43),
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
    expect(response.headers.get("set-cookie")).toContain(
      `lnd_session=${sessionId}`,
    );
    expect(response.headers.get("set-cookie")).toContain("Path=/");
    expect(getSessionMaxAgeMock).toHaveBeenCalledWith(
      "2026-08-17T16:00:00.000+00:00",
    );
    expect(response.headers.get("location")).not.toContain(sessionId);
  });

  it("reuses a canonical short-lived deduplication token", async () => {
    const retainedToken = "r".repeat(43);
    readDedupeTokenMock.mockReturnValue(retainedToken);

    const response = await GET(request(), context());

    expect(createDedupeTokenMock).not.toHaveBeenCalled();
    expect(hashDedupeTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        keyVersion: linkRow.key_version,
        linkId,
        token: retainedToken,
      }),
    );
    expect(response.headers.get("set-cookie")).toContain(
      `lnd_click_dedupe=${retainedToken}`,
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=1800");
  });

  it("binds the declared automated-agent signal to policy version 1", async () => {
    isAutomatedAgentMock.mockReturnValue(true);
    rpcMock.mockResolvedValue({
      data: [
        {
          ...clickResult("eligible")[0],
          quality_outcome: "rejected",
          session_id: null,
          session_expires_at: null,
          session_was_created: false,
        },
      ],
      error: null,
    });

    const response = await GET(request(), context());

    expect(rpcMock).toHaveBeenCalledWith(
      "record_tracked_link_click_v3",
      expect.objectContaining({
        target_automated_agent_detected: true,
        target_automated_agent_policy_version: 1,
      }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("set-cookie")).not.toContain("lnd_session=");
  });

  it("records a forged signature without forwarding or revealing link state", async () => {
    verifySignatureMock.mockResolvedValue(false);
    rpcMock.mockResolvedValue({
      data: clickResult("invalid_signature"),
      error: null,
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toBe(
      "This tracked link could not be verified.",
    );
    expect(hashDedupeTokenMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith(
      "record_tracked_link_click_v3",
      expect.objectContaining({
        target_dedupe_key_hash: null,
        target_signature_valid: false,
      }),
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("reuses the server-returned session for duplicate quality evidence", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          ...clickResult("eligible")[0],
          quality_outcome: "duplicate",
          session_was_created: false,
        },
      ],
      error: null,
    });

    const response = await GET(
      new Request(request().url, {
        headers: { cookie: "lnd_session=browser-supplied-value" },
      }),
      context(),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("set-cookie")).toContain(
      `lnd_session=${sessionId}`,
    );
    expect(rpcMock).toHaveBeenCalledWith(
      "record_tracked_link_click_v3",
      expect.not.objectContaining({ target_session_id: expect.anything() }),
    );
  });

  it("fails closed if qualified evidence has no server-created session", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          ...clickResult("eligible")[0],
          session_id: null,
          session_expires_at: null,
          session_was_created: false,
        },
      ],
      error: null,
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: "tracked_link_click_record_missing" }),
    );
  });

  it("fails closed if an eligible click has no quality decision", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          ...clickResult("eligible")[0],
          quality_outcome: null,
          session_id: null,
          session_expires_at: null,
          session_was_created: false,
        },
      ],
      error: null,
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("fails closed rather than delivering an expired session", async () => {
    getSessionMaxAgeMock.mockReturnValue(0);

    const response = await GET(request(), context());

    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "anonymous_session_expired_before_delivery",
      }),
    );
  });

  it.each(["revoked", "expired", "destination_not_approved"] as const)(
    "keeps a valid but %s link ineligible",
    async (eligibility) => {
      rpcMock.mockResolvedValue({
        data: clickResult(eligibility),
        error: null,
      });

      const response = await GET(request(), context());

      expect(response.status).toBe(410);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.text()).toBe(
        "This tracked link is no longer active.",
      );
    },
  );

  it("rate limits public requests without appending unbounded evidence", async () => {
    rpcMock.mockResolvedValue({
      data: clickResult("rate_limited"),
      error: null,
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(429);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await response.text()).toBe(
      "Too many tracking requests. Try again shortly.",
    );
  });

  it("fails closed if the database ever marks an unsafe destination eligible", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          ...clickResult("eligible")[0],
          destination_url:
            "https://trusted.example:secret@phishing.example/start",
        },
      ],
      error: null,
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "tracked_link_eligible_destination_invalid",
      }),
    );
  });

  it("does not query private link evidence for malformed public inputs", async () => {
    const malformedSignature = await GET(request("short"), context());
    const malformedLink = await GET(
      request(),
      context("not-a-private-link-identity"),
    );

    expect(malformedSignature.status).toBe(404);
    expect(malformedLink.status).toBe(404);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("returns the same unavailable response for unknown link identities", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    expect(verifySignatureMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("fails closed when immutable click evidence cannot be recorded", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "57014", message: "fixture write failure" },
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "tracked_link_click_record_failed",
        projectId: linkRow.project_id,
      }),
    );
  });
});

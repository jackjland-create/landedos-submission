import { beforeEach, describe, expect, it, vi } from "vitest";

const { logErrorMock, rpcMock } = vi.hoisted(() => ({
  logErrorMock: vi.fn(() => "corr_rule_test"),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({ logError: logErrorMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: rpcMock })),
}));

import { POST } from "./route";

const input = {
  ruleId: "a1000000-0000-4000-8000-000000000001",
  ruleVersionId: "a2000000-0000-4000-8000-000000000001",
  changeRequestId: "a3000000-0000-4000-8000-000000000001",
  templateCode: "first_qualifying_transaction",
  name: "First qualifying transaction",
  description: "Count the first finalized Solana transfer after consent.",
  effectiveFrom: "2026-08-12T14:00:00.000Z",
  effectiveUntil: null,
  programId: null,
  eventDiscriminator: null,
  configuredEnvironment: "devnet",
  destinationAddress: "Vote111111111111111111111111111111111111111",
  nativeAmountLamports: "1",
  changeReason: "Create the initial campaign outcome definition",
};

function request(body: unknown) {
  return new Request(
    "https://landed.test/api/projects/helios/conversion-rules",
    { method: "POST", body: JSON.stringify(body) },
  );
}

function context(projectId = "helios") {
  return { params: Promise.resolve({ projectId }) };
}

describe("conversion rule configuration route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({
      data: [
        {
          rule_id: input.ruleId,
          rule_version_id: input.ruleVersionId,
          version: 1,
          inserted: true,
          created_at: "2026-08-12T14:00:00+00:00",
          replay_job_id: null,
          affected_campaign_count: 2,
        },
      ],
      error: null,
    });
  });

  it("creates an immutable project conversion version", async () => {
    const response = await POST(request(input), context());
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      rule: {
        id: input.ruleId,
        versionId: input.ruleVersionId,
        version: 1,
        created: true,
        createdAt: "2026-08-12T14:00:00.000Z",
        replayJobId: null,
        replayAvailable: false,
        affectedCampaignCount: 2,
      },
    });
    expect(rpcMock).toHaveBeenCalledWith(
      "configure_conversion_rule_version_v2",
      expect.objectContaining({
        target_project_id: "20000000-0000-4000-8000-000000000001",
        target_template_code: "first_qualifying_transaction",
        target_program_id: null,
        target_configured_environment: "devnet",
        target_destination_address:
          "Vote111111111111111111111111111111111111111",
        target_native_amount_lamports: "1",
      }),
    );
  });

  it("returns the retained version for an exact replay", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          rule_id: input.ruleId,
          rule_version_id: input.ruleVersionId,
          version: 1,
          inserted: false,
          created_at: "2026-08-12T14:00:00Z",
          replay_job_id: "a4000000-0000-4000-8000-000000000001",
          affected_campaign_count: 2,
        },
      ],
      error: null,
    });
    const response = await POST(request(input), context());
    expect(response.status).toBe(200);
    expect((await response.json()).rule.created).toBe(false);
  });

  it("preserves the original procedure for non-destination templates", async () => {
    const walletRule = {
      ...input,
      templateCode: "wallet_connected",
      configuredEnvironment: null,
      destinationAddress: null,
      nativeAmountLamports: null,
    };

    expect((await POST(request(walletRule), context())).status).toBe(201);
    expect(rpcMock).toHaveBeenCalledWith(
      "configure_conversion_rule_version",
      expect.not.objectContaining({
        target_configured_environment: expect.anything(),
      }),
    );
  });

  it("rejects new broad transaction rules before reaching the database", async () => {
    const response = await POST(
      request({
        ...input,
        configuredEnvironment: null,
        destinationAddress: null,
        nativeAmountLamports: null,
      }),
      context(),
    );
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("fails closed for malformed, denied and conflicting changes", async () => {
    expect((await POST(request({}), context())).status).toBe(400);
    expect(
      (await POST(request(input), context("another-project"))).status,
    ).toBe(400);

    rpcMock.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect((await POST(request(input), context())).status).toBe(403);

    rpcMock.mockResolvedValue({ data: null, error: { code: "55000" } });
    expect((await POST(request(input), context())).status).toBe(409);
  });

  it("returns an opaque reference for an incomplete database response", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const response = await POST(request(input), context());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      message: "Conversion definition could not be saved.",
      reference: "corr_rule_test",
    });
  });
});

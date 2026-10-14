import { beforeEach, describe, expect, it, vi } from "vitest";

const { inngestSendMock, logErrorMock, rpcMock } = vi.hoisted(() => ({
  inngestSendMock: vi.fn(),
  logErrorMock: vi.fn(() => "corr_helius_ingestion"),
  rpcMock: vi.fn(),
}));

vi.mock("@/inngest/client", () => ({
  inngest: { send: inngestSendMock },
}));
vi.mock("@/lib/observability", () => ({ logError: logErrorMock }));
vi.mock("@/lib/supabase/server", () => {
  class SupabaseServerConfigError extends Error {}
  return {
    createAdminClient: vi.fn(() => ({ rpc: rpcMock })),
    SupabaseServerConfigError,
  };
});

import { POST } from "./route";

const integrationId = "65000000-0000-4000-8000-000000000001";
const retainedDeliveryId = "65000000-0000-4000-8000-000000000002";
const rawChainEventId = "65000000-0000-4000-8000-000000000003";
const authorization = "helius-test-auth-token-0123456789abcdef";
const credentialVersion = "helius-test-v1";
const payload = [
  {
    accountData: [],
    description: "Sanitized programme action fixture",
    events: {},
    fee: 5_000,
    feePayer: "So11111111111111111111111111111111111111112",
    nativeTransfers: [],
    signature:
      "5nNtjezQMYBHvgSQmoRmJPiXGsPAWmJPoGSa64xanqrauogiVzFyGQhKeFataHGXq51jR2hjbzNTkPUpP787HAmL",
    slot: 358_000_001,
    source: "SYSTEM_PROGRAM",
    timestamp: 1_786_473_600,
    tokenTransfers: [],
    transactionError: null,
    type: "TRANSFER",
  },
];
const rawBody = JSON.stringify(payload);

function request(body = rawBody, token = authorization) {
  return new Request("https://landed.test/api/integrations/helius", {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body,
  });
}

describe("Helius raw-ingestion route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HELIUS_WEBHOOK_INTEGRATION_ID = integrationId;
    process.env.HELIUS_WEBHOOK_CREDENTIAL_VERSION = credentialVersion;
    process.env.HELIUS_WEBHOOK_AUTHORIZATION = authorization;
    inngestSendMock.mockResolvedValue({ ids: [] });
    rpcMock.mockImplementation(
      (name: string, args: { target_delivery_id: string }) => {
        if (name === "get_raw_chain_event_ids_for_delivery") {
          return Promise.resolve({
            data: [{ raw_chain_event_id: rawChainEventId }],
            error: null,
          });
        }
        return Promise.resolve({
          data: [
            {
              delivery_id: args.target_delivery_id,
              event_count: 1,
              inserted: true,
              received_at: "2026-08-11T20:00:00.000+00:00",
            },
          ],
          error: null,
        });
      },
    );
  });

  it("acknowledges only after the exact authenticated body is retained", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("");
    expect(rpcMock).toHaveBeenCalledWith("persist_helius_raw_delivery", {
      target_delivery_id: expect.any(String),
      target_credential_fingerprint_sha256:
        "d5b8a1e16d63d345b4cbac9ad62240cfe927144c29f2a6a9c765de5c06892fc8",
      target_credential_version: credentialVersion,
      target_integration_id: integrationId,
      target_raw_body: rawBody,
    });
    expect(inngestSendMock).toHaveBeenCalledWith([
      {
        data: { rawChainEventId },
        id: `raw-chain:${rawChainEventId}`,
        name: "landed/solana.raw-event.received",
      },
    ]);
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("acknowledges an idempotently retained duplicate", async () => {
    rpcMock.mockImplementationOnce(() =>
      Promise.resolve({
        data: [
          {
            delivery_id: retainedDeliveryId,
            event_count: 1,
            inserted: false,
            received_at: "2026-08-11T19:59:00.000+00:00",
          },
        ],
        error: null,
      }),
    );

    expect((await POST(request())).status).toBe(200);
    expect(inngestSendMock).toHaveBeenCalledWith([
      {
        data: { rawChainEventId },
        id: `raw-chain:${rawChainEventId}`,
        name: "landed/solana.raw-event.received",
      },
    ]);
  });

  it("rejects forged authorization before malformed JSON is parsed", async () => {
    expect(
      (await POST(request("not-json", `${authorization}-forged`))).status,
    ).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects malformed authenticated deliveries without persistence", async () => {
    expect((await POST(request("not-json"))).status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("fails closed when configuration, persistence or evidence is missing", async () => {
    delete process.env.HELIUS_WEBHOOK_INTEGRATION_ID;
    delete process.env.HELIUS_WEBHOOK_CREDENTIAL_VERSION;
    expect((await POST(request())).status).toBe(503);
    expect(rpcMock).not.toHaveBeenCalled();

    process.env.HELIUS_WEBHOOK_INTEGRATION_ID = integrationId;
    process.env.HELIUS_WEBHOOK_CREDENTIAL_VERSION = credentialVersion;
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    expect((await POST(request())).status).toBe(503);
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: "helius_raw_delivery_persist_failed" }),
    );

    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "54000" } });
    expect((await POST(request())).status).toBe(503);
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "helius_raw_ingestion_capacity_exhausted",
      }),
    );

    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "55000" } });
    expect((await POST(request())).status).toBe(503);
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "helius_ingestion_operationally_blocked",
      }),
    );

    rpcMock.mockResolvedValueOnce({
      data: [
        {
          delivery_id: retainedDeliveryId,
          event_count: 2,
          inserted: false,
          received_at: "2026-08-11T19:59:00.000+00:00",
        },
      ],
      error: null,
    });
    expect((await POST(request())).status).toBe(503);
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "helius_raw_delivery_evidence_mismatch",
      }),
    );
  });
});

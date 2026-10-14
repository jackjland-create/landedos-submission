import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  finalityMock,
  inngestCreateFunctionMock,
  inngestSendMock,
  logErrorMock,
  rpcMock,
} = vi.hoisted(() => ({
  finalityMock: vi.fn(),
  inngestCreateFunctionMock: vi.fn(
    (_config: unknown, _trigger: unknown, handler: unknown) => ({ handler }),
  ),
  inngestSendMock: vi.fn(),
  logErrorMock: vi.fn(() => "corr_devnet_runtime"),
  rpcMock: vi.fn(),
}));

vi.mock("@/inngest/client", () => ({
  inngest: {
    createFunction: inngestCreateFunctionMock,
    send: inngestSendMock,
  },
}));
vi.mock("@/lib/observability", () => ({ logError: logErrorMock }));
vi.mock("@/lib/solana/finality.server", () => ({
  fetchFinalizedSignatureEvidence: finalityMock,
}));
vi.mock("@/lib/supabase/server", () => {
  class SupabaseServerConfigError extends Error {}
  return {
    createAdminClient: vi.fn(() => ({ rpc: rpcMock })),
    SupabaseServerConfigError,
  };
});

import { processLiveRawChainEvent } from "@/inngest/process-live-solana";
import { POST } from "@/app/api/integrations/helius/route";

import fixture from "../../../../../packages/solana/src/fixtures/helius-enhanced-normalization.json";

const integrationId = "6a000000-0000-4000-8000-000000000001";
const rawChainEventId = "6a000000-0000-4000-8000-000000000002";
const authorization = "helius-sanitized-devnet-token-0123456789";
const credentialVersion = "helius-sanitized-devnet-v1";
const receiver = "So11111111111111111111111111111111111111112";
const sender = "11111111111111111111111111111111";
const payload = [
  {
    ...fixture,
    accountData: [],
    description: "Sanitized one-lamport devnet campaign response",
    nativeTransfers: [
      {
        amount: 1,
        fromUserAccount: sender,
        toUserAccount: receiver,
      },
    ],
    tokenTransfers: [],
  },
];
const rawBody = JSON.stringify(payload);

const exactWriterFunctions = new Set([
  "load_campaign_conversion_candidate",
  "preview_campaign_execution",
  "approve_campaign_execution",
  "execute_reviewed_campaign_execution",
  "execute_campaign_conversion_batch",
  "record_campaign_conversion_result",
]);

describe("sanitized devnet ingestion runtime boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HELIUS_WEBHOOK_INTEGRATION_ID = integrationId;
    process.env.HELIUS_WEBHOOK_CREDENTIAL_VERSION = credentialVersion;
    process.env.HELIUS_WEBHOOK_AUTHORIZATION = authorization;

    inngestSendMock.mockResolvedValue({ ids: [] });
    finalityMock.mockResolvedValue({
      confirmationStatus: "finalized",
      confirmations: null,
      contextSlot: String(fixture.slot + 8),
      method: "getSignatureStatuses",
      rpcResponse: {
        id: "landed-finality",
        jsonrpc: "2.0",
        result: {
          context: { slot: fixture.slot + 8 },
          value: [
            {
              confirmationStatus: "finalized",
              confirmations: null,
              err: null,
              slot: fixture.slot,
              status: { Ok: null },
            },
          ],
        },
      },
      signature: fixture.signature,
      transactionSlot: String(fixture.slot),
    });

    rpcMock.mockImplementation(
      async (name: string, args: Record<string, unknown>) => {
        if (name === "persist_helius_raw_delivery") {
          return {
            data: [
              {
                delivery_id: args.target_delivery_id,
                event_count: 1,
                inserted: true,
                received_at: "2026-09-24T12:00:00.000+00:00",
              },
            ],
            error: null,
          };
        }
        if (name === "get_raw_chain_event_ids_for_delivery") {
          return {
            data: [{ raw_chain_event_id: rawChainEventId }],
            error: null,
          };
        }
        if (name === "get_raw_chain_event_for_normalization") {
          return {
            data: [
              {
                acquisition_source: "helius_webhook",
                configured_environment: "devnet",
                integration_id: integrationId,
                project_id: "6a000000-0000-4000-8000-000000000003",
                raw_chain_event_id: rawChainEventId,
                raw_payload: payload[0],
                received_at: "2026-09-24T12:00:00.000789Z",
                transaction_signature: fixture.signature,
                transaction_slot: String(fixture.slot),
                workspace_id: "6a000000-0000-4000-8000-000000000004",
              },
            ],
            error: null,
          };
        }
        if (name === "persist_finalized_canonical_chain_event") {
          return {
            data: [
              {
                canonical_event_id: args.target_canonical_event_id,
                finality: "finalized",
                inserted: true,
                raw_chain_event_id: rawChainEventId,
              },
            ],
            error: null,
          };
        }
        throw new Error(`Unexpected runtime RPC: ${name}`);
      },
    );
  });

  it("requests canonical retention and stops before human-controlled campaign execution", async () => {
    const response = await POST(
      new Request("https://landed.test/api/integrations/helius", {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: rawBody,
      }),
    );

    expect(response.status).toBe(200);
    expect(inngestSendMock).toHaveBeenCalledExactlyOnceWith([
      {
        data: { rawChainEventId },
        id: `raw-chain:${rawChainEventId}`,
        name: "landed/solana.raw-event.received",
      },
    ]);

    const result = await processLiveRawChainEvent(rawChainEventId);

    expect(result).toMatchObject({
      insertedCount: 1,
      issueCount: 0,
      rawChainEventId,
    });
    expect(finalityMock).toHaveBeenCalledExactlyOnceWith(
      fixture.signature,
      String(fixture.slot),
    );
    expect(rpcMock).toHaveBeenCalledWith(
      "persist_finalized_canonical_chain_event",
      expect.objectContaining({
        target_canonical_payload: expect.objectContaining({
          fromAddress: sender,
          nativeAmountLamports: "1",
          toAddress: receiver,
        }),
      }),
    );

    const calledFunctions = rpcMock.mock.calls.map(([name]) => String(name));
    expect(calledFunctions).toEqual([
      "persist_helius_raw_delivery",
      "get_raw_chain_event_ids_for_delivery",
      "get_raw_chain_event_for_normalization",
      "persist_finalized_canonical_chain_event",
    ]);
    expect(calledFunctions.some((name) => exactWriterFunctions.has(name))).toBe(
      false,
    );
    expect(logErrorMock).not.toHaveBeenCalled();
  });
});

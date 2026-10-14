import { afterEach, describe, expect, it, vi } from "vitest";

import fixture from "../../../../../packages/solana/src/fixtures/helius-enhanced-normalization.json";

import {
  fetchFinalizedSignatureEvidence,
  SolanaFinalityConfigError,
  SolanaFinalityRequestError,
} from "./finality.server";

const rpcResponse = {
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
};

describe("server-only Solana finality verification", () => {
  afterEach(() => {
    delete process.env.SOLANA_FINALITY_RPC_URL;
    delete process.env.LANDED_LOCAL_DEVNET_REHEARSAL;
  });

  it("requests historical signature status and retains exact evidence", async () => {
    process.env.SOLANA_FINALITY_RPC_URL = "https://rpc.example.test/finality";
    const fetcher = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify(rpcResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const evidence = await fetchFinalizedSignatureEvidence(
      fixture.signature,
      String(fixture.slot),
      fetcher,
    );

    expect(evidence.rpcResponse).toEqual(rpcResponse);
    expect(fetcher).toHaveBeenCalledWith(
      "https://rpc.example.test/finality",
      expect.objectContaining({
        body: JSON.stringify({
          id: "landed-finality",
          jsonrpc: "2.0",
          method: "getSignatureStatuses",
          params: [[fixture.signature], { searchTransactionHistory: true }],
        }),
        cache: "no-store",
        redirect: "error",
      }),
    );
  });

  it("fails closed for missing configuration or unsuccessful responses", async () => {
    await expect(
      fetchFinalizedSignatureEvidence(
        fixture.signature,
        String(fixture.slot),
        vi.fn(),
      ),
    ).rejects.toBeInstanceOf(SolanaFinalityConfigError);

    process.env.SOLANA_FINALITY_RPC_URL = "http://rpc.example.test";
    await expect(
      fetchFinalizedSignatureEvidence(
        fixture.signature,
        String(fixture.slot),
        vi.fn(),
      ),
    ).rejects.toBeInstanceOf(SolanaFinalityConfigError);

    process.env.SOLANA_FINALITY_RPC_URL = "https://rpc.example.test";
    await expect(
      fetchFinalizedSignatureEvidence(
        fixture.signature,
        String(fixture.slot),
        vi.fn(async () =>
          Promise.resolve(new Response("upstream", { status: 503 })),
        ),
      ),
    ).rejects.toBeInstanceOf(SolanaFinalityRequestError);
  });

  it("accepts loopback HTTP only inside the explicit local rehearsal gate", async () => {
    process.env.SOLANA_FINALITY_RPC_URL = "http://127.0.0.1:39491/finality";
    await expect(
      fetchFinalizedSignatureEvidence(
        fixture.signature,
        String(fixture.slot),
        vi.fn(),
      ),
    ).rejects.toBeInstanceOf(SolanaFinalityConfigError);

    process.env.LANDED_LOCAL_DEVNET_REHEARSAL = "1";
    const fetcher = vi.fn(async () =>
      Promise.resolve(new Response(JSON.stringify(rpcResponse))),
    );
    await expect(
      fetchFinalizedSignatureEvidence(
        fixture.signature,
        String(fixture.slot),
        fetcher,
      ),
    ).resolves.toMatchObject({ signature: fixture.signature });
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:39491/finality",
      expect.any(Object),
    );

    process.env.SOLANA_FINALITY_RPC_URL = "http://provider.example.test";
    await expect(
      fetchFinalizedSignatureEvidence(
        fixture.signature,
        String(fixture.slot),
        vi.fn(),
      ),
    ).rejects.toBeInstanceOf(SolanaFinalityConfigError);
  });

  it("rejects malformed and oversized provider responses", async () => {
    process.env.SOLANA_FINALITY_RPC_URL = "https://rpc.example.test";

    await expect(
      fetchFinalizedSignatureEvidence(
        fixture.signature,
        String(fixture.slot),
        vi.fn(async () => Promise.resolve(new Response("not-json"))),
      ),
    ).rejects.toBeInstanceOf(SolanaFinalityRequestError);

    const declaredOversized = new Response("{}", {
      headers: { "Content-Length": "32769" },
    });
    await expect(
      fetchFinalizedSignatureEvidence(
        fixture.signature,
        String(fixture.slot),
        vi.fn(async () => Promise.resolve(declaredOversized)),
      ),
    ).rejects.toBeInstanceOf(SolanaFinalityRequestError);

    await expect(
      fetchFinalizedSignatureEvidence(
        fixture.signature,
        String(fixture.slot),
        vi.fn(async () => Promise.resolve(new Response(" ".repeat(32_769)))),
      ),
    ).rejects.toBeInstanceOf(SolanaFinalityRequestError);

    const invalidUtf8 = new Response(new Uint8Array([0xc3, 0x28]));
    await expect(
      fetchFinalizedSignatureEvidence(
        fixture.signature,
        String(fixture.slot),
        vi.fn(async () => Promise.resolve(invalidUtf8)),
      ),
    ).rejects.toBeInstanceOf(SolanaFinalityRequestError);
  });
});

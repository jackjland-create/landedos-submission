import { describe, expect, it } from "vitest";

import {
  SolanaFinalityEvidenceError,
  verifyFinalizedSignatureStatus,
} from "./finality";
import fixture from "./fixtures/helius-enhanced-normalization.json";

const response = {
  id: "landed-finality",
  jsonrpc: "2.0",
  result: {
    context: { slot: fixture.slot + 32 },
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

describe("Solana finalized signature evidence", () => {
  it("retains one exact finalized status response", () => {
    expect(
      verifyFinalizedSignatureStatus(
        response,
        fixture.signature,
        String(fixture.slot),
      ),
    ).toEqual({
      confirmationStatus: "finalized",
      confirmations: null,
      contextSlot: String(fixture.slot + 32),
      method: "getSignatureStatuses",
      rpcResponse: response,
      signature: fixture.signature,
      transactionSlot: String(fixture.slot),
    });
  });

  it.each([
    [
      "missing status",
      { ...response, result: { ...response.result, value: [null] } },
    ],
    [
      "confirmed only",
      {
        ...response,
        result: {
          ...response.result,
          value: [
            { ...response.result.value[0], confirmationStatus: "confirmed" },
          ],
        },
      },
    ],
    [
      "failed transaction",
      {
        ...response,
        result: {
          ...response.result,
          value: [
            { ...response.result.value[0], err: { InstructionError: [] } },
          ],
        },
      },
    ],
    [
      "wrong transaction slot",
      {
        ...response,
        result: {
          ...response.result,
          value: [{ ...response.result.value[0], slot: fixture.slot + 1 }],
        },
      },
    ],
    [
      "context behind transaction",
      {
        ...response,
        result: { ...response.result, context: { slot: fixture.slot - 1 } },
      },
    ],
  ])("rejects %s evidence", (_label, candidate) => {
    expect(() =>
      verifyFinalizedSignatureStatus(
        candidate,
        fixture.signature,
        String(fixture.slot),
      ),
    ).toThrow(SolanaFinalityEvidenceError);
  });
});

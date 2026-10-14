import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getWalletMeasurementDeploymentReceiver,
  readWalletMeasurementRuleContext,
  WalletMeasurementContextError,
} from "./measurement-context.server";

const receiver = "Vote111111111111111111111111111111111111111";
const row = {
  rule_version_id: "61990000-0000-4000-8000-000000000001",
  chain_id: "solana:devnet",
  configured_environment: "devnet",
  destination_address: receiver,
  native_amount_lamports: "1",
};

afterEach(() => vi.unstubAllEnvs());

describe("wallet measurement rule context", () => {
  it("requires an explicit devnet deployment receiver", () => {
    vi.stubEnv("WALLET_MEASUREMENT_CHAIN_ID", "solana:mainnet");
    vi.stubEnv("MEASUREMENT_DEVNET_RECEIVER_ADDRESS", receiver);
    expect(getWalletMeasurementDeploymentReceiver()).toBeNull();

    vi.stubEnv("WALLET_MEASUREMENT_CHAIN_ID", "solana:devnet");
    expect(getWalletMeasurementDeploymentReceiver()).toBe(receiver);
  });

  it("returns the exact approved rule when deployment and session agree", async () => {
    vi.stubEnv("WALLET_MEASUREMENT_CHAIN_ID", "solana:devnet");
    vi.stubEnv("MEASUREMENT_DEVNET_RECEIVER_ADDRESS", receiver);
    const rpc = vi.fn(async () => ({ data: [row], error: null }));

    await expect(
      readWalletMeasurementRuleContext(
        { rpc },
        "90990000-0000-4000-8000-000000000005",
      ),
    ).resolves.toEqual({
      ruleVersionId: row.rule_version_id,
      chainId: "solana:devnet",
      receiverAddress: receiver,
      nativeAmountLamports: "1",
    });
    expect(rpc).toHaveBeenCalledWith("read_wallet_measurement_rule_context", {
      target_anonymous_session_id: "90990000-0000-4000-8000-000000000005",
    });
  });

  it("fails closed when the approved receiver differs from deployment", async () => {
    vi.stubEnv("WALLET_MEASUREMENT_CHAIN_ID", "solana:devnet");
    vi.stubEnv(
      "MEASUREMENT_DEVNET_RECEIVER_ADDRESS",
      "11111111111111111111111111111111",
    );
    const rpc = vi.fn(async () => ({ data: [row], error: null }));

    await expect(
      readWalletMeasurementRuleContext(
        { rpc },
        "90990000-0000-4000-8000-000000000005",
      ),
    ).resolves.toBeNull();
  });

  it("rejects malformed or duplicate database contexts", async () => {
    vi.stubEnv("WALLET_MEASUREMENT_CHAIN_ID", "solana:devnet");
    vi.stubEnv("MEASUREMENT_DEVNET_RECEIVER_ADDRESS", receiver);

    await expect(
      readWalletMeasurementRuleContext(
        { rpc: vi.fn(async () => ({ data: [row, row], error: null })) },
        "90990000-0000-4000-8000-000000000005",
      ),
    ).rejects.toBeInstanceOf(WalletMeasurementContextError);
    await expect(
      readWalletMeasurementRuleContext(
        {
          rpc: vi.fn(async () => ({
            data: [{ ...row, native_amount_lamports: "2" }],
            error: null,
          })),
        },
        "90990000-0000-4000-8000-000000000005",
      ),
    ).rejects.toBeInstanceOf(WalletMeasurementContextError);
  });
});

import "server-only";

import { solanaWalletAddressSchema } from "@landed/contracts";
import { z } from "zod";

import { getWalletMeasurementChainId } from "./challenge.server";

const resultSchema = z.array(
  z.object({
    rule_version_id: z.uuid(),
    chain_id: z.literal("solana:devnet"),
    configured_environment: z.literal("devnet"),
    destination_address: solanaWalletAddressSchema,
    native_amount_lamports: z.literal("1"),
  }),
);

type RpcClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

export type WalletMeasurementRuleContext = {
  ruleVersionId: string;
  chainId: "solana:devnet";
  receiverAddress: string;
  nativeAmountLamports: "1";
};

export class WalletMeasurementContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletMeasurementContextError";
  }
}

export function getWalletMeasurementDeploymentReceiver() {
  if (getWalletMeasurementChainId() !== "solana:devnet") return null;

  const receiver = solanaWalletAddressSchema.safeParse(
    process.env.MEASUREMENT_DEVNET_RECEIVER_ADDRESS,
  );
  return receiver.success ? receiver.data : null;
}

export async function readWalletMeasurementRuleContext(
  client: RpcClient,
  anonymousSessionId: string,
): Promise<WalletMeasurementRuleContext | null> {
  const deploymentReceiver = getWalletMeasurementDeploymentReceiver();
  if (!deploymentReceiver) return null;

  const { data, error } = await client.rpc(
    "read_wallet_measurement_rule_context",
    { target_anonymous_session_id: anonymousSessionId },
  );
  if (error) {
    throw new WalletMeasurementContextError(
      "The approved wallet measurement rule could not be read.",
    );
  }

  const parsed = resultSchema.safeParse(data);
  if (!parsed.success) {
    throw new WalletMeasurementContextError(
      "The approved wallet measurement rule was not canonical.",
    );
  }
  if (parsed.data.length === 0) return null;
  if (parsed.data.length !== 1) {
    throw new WalletMeasurementContextError(
      "The wallet measurement session resolved more than one rule.",
    );
  }

  const [row] = parsed.data;
  if (!row || row.destination_address !== deploymentReceiver) return null;

  return {
    ruleVersionId: row.rule_version_id,
    chainId: row.chain_id,
    receiverAddress: row.destination_address,
    nativeAmountLamports: row.native_amount_lamports,
  };
}

"use client";

import { useCallback, useState } from "react";
import { LocalDevnetActivationHandoff } from "@/components/local-devnet-activation-handoff";

// Development route only. No API calls, credentials, provider or wallet actions.
export function ActivationFixture({
  state,
  canManage,
}: {
  state: string;
  canManage: boolean;
}) {
  const [startedAt] = useState(() => Date.now());
  const transport = useCallback(
    async (
      input: Record<string, unknown>,
      read?: boolean,
    ): Promise<unknown> => {
      if (!read)
        throw new Error("Synthetic read-only fixture: writes are unavailable.");
      if (state === "loading") return new Promise(() => {});
      if (
        state === "error" ||
        (state === "copy-error" && input.action === "readSignedLink")
      )
        throw new Error(
          "Synthetic retained read unavailable. Retry retained status.",
        );
      const expiry = new Date(startedAt + 30 * 60 * 1000).toISOString();
      if (input.action === "readSignedLink")
        return {
          url: "https://participant.example.test/t/3aa1d656-4075-4c91-935d-cd2f510fff75?signature=synthetic-not-valid",
          expiresAt:
            state === "expired"
              ? new Date(startedAt - 1000).toISOString()
              : expiry,
        };
      return {
        status: "live",
        campaignId: "9aa1d656-4075-4c91-935d-cd2f510fff75",
        campaignStatus: "live",
        commercialPlanVersionId: "7aa1d656-4075-4c91-935d-cd2f510fff75",
        commercialSnapshotHash: "a".repeat(64),
        rule: {
          id: "6aa1d656-4075-4c91-935d-cd2f510fff75",
          name: "Synthetic receiver-only rule",
          configuredEnvironment: "devnet",
          destinationAddress: "11111111111111111111111111111111",
          nativeAmountLamports: "1",
          effectiveFrom: new Date(startedAt).toISOString(),
          effectiveUntil: expiry,
        },
        measurement: {
          startedAt: new Date(startedAt).toISOString(),
          endedAt: expiry,
        },
        brief: { version: 1, status: "approved" },
        destination: {
          url: "https://participant.example.test/measure",
          capabilityExpiresAt: expiry,
        },
        assets:
          state === "empty"
            ? []
            : [
                {
                  contentAssetId: "8aa1d656-4075-4c91-935d-cd2f510fff75",
                  creatorId: "4aa1d656-4075-4c91-935d-cd2f510fff75",
                  label: "Internal test participant",
                  trackedLinkId: "3aa1d656-4075-4c91-935d-cd2f510fff75",
                  linkExpiresAt: expiry,
                },
              ],
        blockers: [],
      };
    },
    [startedAt, state],
  );
  return (
    <LocalDevnetActivationHandoff
      campaignId="9aa1d656-4075-4c91-935d-cd2f510fff75"
      canManage={canManage}
      transport={transport}
    />
  );
}

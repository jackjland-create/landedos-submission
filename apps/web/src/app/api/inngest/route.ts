import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { processLiveSolanaEvent } from "@/inngest/process-live-solana";
import { reconcileSolanaHistory } from "@/inngest/reconcile-solana-history";
import { replayConversionHistory } from "@/inngest/replay-conversion-history";

export const maxDuration = 300;
export const runtime = "nodejs";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions:
    process.env.LANDED_SAME_COPY_PROCESSING !== undefined
      ? [reconcileSolanaHistory]
      : [
          processLiveSolanaEvent,
          reconcileSolanaHistory,
          replayConversionHistory,
        ],
  streaming: "allow",
});

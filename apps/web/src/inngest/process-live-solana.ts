import { z } from "zod";

import { processFinalizedRawChainEvent } from "@/lib/solana/canonical-processing.server";
import { createAdminClient } from "@/lib/supabase/server";

import { inngest } from "./client";

const liveRawEventSchema = z.object({ rawChainEventId: z.uuid() });

export async function processLiveRawChainEvent(rawChainEventId: string) {
  const parsed = liveRawEventSchema.parse({ rawChainEventId });
  return processFinalizedRawChainEvent(
    createAdminClient(),
    parsed.rawChainEventId,
  );
}

export const processLiveSolanaEvent = inngest.createFunction(
  {
    id: "process-live-solana-event",
    name: "Process live Solana event",
    concurrency: { limit: 5, key: "event.data.rawChainEventId" },
    idempotency: "event.data.rawChainEventId",
    retries: 3,
  },
  { event: "landed/solana.raw-event.received" },
  async ({ event, step }) => {
    const { rawChainEventId } = liveRawEventSchema.parse(event.data);
    return step.run("normalize-and-finalize", () =>
      processLiveRawChainEvent(rawChainEventId),
    );
  },
);

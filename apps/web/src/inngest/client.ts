import { EventSchemas, Inngest } from "inngest";

export const inngest = new Inngest({
  id: "landed-kol-os",
  schemas: new EventSchemas().fromRecord<{
    "landed/solana.reconciliation.requested": {
      data: { jobId: string };
    };
    "landed/solana.raw-event.received": {
      data: { rawChainEventId: string };
    };
    "landed/conversion.replay.approved": {
      data: { replayRunId: string };
    };
  }>(),
});

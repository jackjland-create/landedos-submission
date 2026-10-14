"use client";
import Link from "next/link";
import { BasketTimingPanel } from "@/components/basket-timing-panel";
import type { TimingSessionClient } from "@/lib/baskets/timing-session";

let saved = {
  ownerId: "91000000-0000-4000-8000-000000000088",
  canManage: true,
  revision: 3,
  timing: {
    schemaVersion: 1 as const,
    flight: {
      startedAt: "2026-09-14T09:00:00Z",
      endedAt: "2026-10-05T17:00:00Z",
    },
    measurement: {
      startedAt: "2026-09-14T00:00:00Z",
      endedAt: "2026-10-12T17:00:00Z",
    },
  },
};
const client: TimingSessionClient = {
  load: async () => structuredClone(saved),
  save: async (input) => {
    if (
      input.expectedRevision !== saved.revision ||
      input.expectedOwnerId !== saved.ownerId
    )
      throw new Error("Fixture conflict");
    saved = {
      ...saved,
      revision: saved.revision + 1,
      timing: structuredClone(input.timing),
    };
    return { revision: saved.revision };
  },
};
export function TimingRehearsal({ away = false }: { away?: boolean }) {
  return (
    <main style={{ padding: 24 }}>
      <h1>Browser recovery rehearsal</h1>
      <p>
        Simulated dates. No account or database is connected. This tests browser
        navigation only.
      </p>
      {away ? (
        <>
          <Link href="/visual-tests/reporting-studio/timing-recovery">
            Open date planning
          </Link>
          <button
            type="button"
            onClick={() => {
              saved = { ...saved, revision: saved.revision + 1 };
            }}
          >
            Simulate another saved change
          </button>
        </>
      ) : (
        <>
          <Link href="/visual-tests/reporting-studio/timing-recovery/away">
            Leave date planning
          </Link>
          <BasketTimingPanel
            projectId="helios"
            basketId="90000000-0000-4000-8000-000000000088"
            canManage
            client={client}
          />
        </>
      )}
    </main>
  );
}

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  commercialPlanReviewSchema,
  strategyBoundCommercialPlanSnapshotSchema,
} from "@landed/contracts";
import { previewBasketStrategyApproval } from "./basket-approval";
import fixture from "./fixtures/bsk09-preview.json";

// Captured from the isolated pgTAP fixture, not a hand-invented RPC response.
const snapshot = strategyBoundCommercialPlanSnapshotSchema.parse(
  fixture[0]!.review_snapshot,
);
const scope = {
  workspaceId: snapshot.workspaceId,
  projectId: snapshot.projectId,
  basketId: snapshot.basket.id,
};
const input = {
  scenarioId: snapshot.scenario.id,
  expectedStrategyRevision: snapshot.strategyBinding.revision,
  measurementStartedAt: snapshot.strategyBinding.measurementWindow.startedAt,
  measurementEndedAt: snapshot.strategyBinding.measurementWindow.endedAt,
};
const copy = () => JSON.parse(JSON.stringify(fixture)) as typeof fixture;
function clientFor(data: unknown = fixture, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { rpc, client: { rpc } as unknown as SupabaseClient };
}

describe("BSK-09 authoritative strategy preview reader", () => {
  it("decodes actual PostgreSQL output and keeps its hash unchanged", async () => {
    const { client, rpc } = clientFor();
    expect(await previewBasketStrategyApproval(client, scope, input)).toEqual({
      snapshot,
      snapshotHash: fixture[0]!.review_snapshot_hash,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "preview_basket_strategy_approval",
      {
        target_project_id: scope.projectId,
        target_basket_id: scope.basketId,
        target_scenario_id: input.scenarioId,
        expected_strategy_revision: input.expectedStrategyRevision,
        measurement_started_at: input.measurementStartedAt,
        measurement_ended_at: input.measurementEndedAt,
      },
    );
  });
  it("does not enable the V2 record in the existing human approval reader", () => {
    expect(
      commercialPlanReviewSchema.safeParse({
        snapshot,
        snapshotHash: fixture[0]!.review_snapshot_hash,
      }).success,
    ).toBe(false);
  });
  it.each(["workspaceId", "projectId", "basketId"] as const)(
    "rejects unexpected %s context",
    async (key) => {
      const { client } = clientFor();
      await expect(
        previewBasketStrategyApproval(
          client,
          { ...scope, [key]: "99999999-0000-4000-8000-000000000001" },
          input,
        ),
      ).rejects.toMatchObject({ code: "invalid_snapshot" });
    },
  );
  it.each([
    { scenarioId: "99999999-0000-4000-8000-000000000001" },
    { expectedStrategyRevision: input.expectedStrategyRevision + 1 },
    { measurementStartedAt: "2026-09-15T00:00:00.000Z" },
    { measurementEndedAt: "2026-10-13T00:00:00.000Z" },
  ])("rejects a response for different reviewed details", async (change) => {
    const { client } = clientFor();
    await expect(
      previewBasketStrategyApproval(client, scope, { ...input, ...change }),
    ).rejects.toMatchObject({ code: "invalid_snapshot" });
  });
  it("accepts equivalent fractional padding without changing retained values", async () => {
    const { client } = clientFor();
    const trim = (value: string) => value.replace(/\.0+Z$/, "Z");
    const result = await previewBasketStrategyApproval(client, scope, {
      ...input,
      measurementStartedAt: trim(input.measurementStartedAt),
      measurementEndedAt: trim(input.measurementEndedAt),
    });
    expect(result.snapshot.strategyBinding.measurementWindow).toEqual(
      snapshot.strategyBinding.measurementWindow,
    );
  });
  it("does not round away a sub-millisecond mismatch", async () => {
    const { client } = clientFor();
    await expect(
      previewBasketStrategyApproval(client, scope, {
        ...input,
        measurementStartedAt: input.measurementStartedAt.replace(
          /(?:\.\d+)?Z$/,
          ".000001Z",
        ),
      }),
    ).rejects.toMatchObject({ code: "invalid_snapshot" });
  });
  it.each([null, [], [{ review_snapshot: {} }], [...fixture, ...fixture]])(
    "rejects malformed or ambiguous RPC results",
    async (data) => {
      const { client } = clientFor(data);
      await expect(
        previewBasketStrategyApproval(client, scope, input),
      ).rejects.toMatchObject({ code: "invalid_snapshot" });
    },
  );
  it("rejects an invalid fingerprint", async () => {
    const data = copy();
    data[0]!.review_snapshot_hash = "not-a-hash";
    await expect(
      previewBasketStrategyApproval(clientFor(data).client, scope, input),
    ).rejects.toMatchObject({ code: "invalid_snapshot" });
  });
  it.each(["42501", "40001", "22023", "55000"])(
    "preserves safe error code %s without exposing provider text",
    async (code) => {
      const { client, rpc } = clientFor(null, {
        code,
        message: "private database details",
      });
      await expect(
        previewBasketStrategyApproval(client, scope, input),
      ).rejects.toMatchObject({
        code,
        message: "Basket approval review could not be prepared.",
      });
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );
  it("validates input before calling the database", async () => {
    const { client, rpc } = clientFor();
    await expect(
      previewBasketStrategyApproval(client, scope, {
        ...input,
        measurementEndedAt: input.measurementStartedAt,
      }),
    ).rejects.toThrow();
    await expect(
      previewBasketStrategyApproval(client, scope, {
        ...input,
        expectedStrategyRevision: 0,
      }),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});

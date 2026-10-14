import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import fixture from "../../contracts/src/fixtures/bsk09-timed-review.json";
import { previewTimedBasketApproval } from "./basket-timed-review";

const snapshot = fixture.review_snapshot;
const input = {
  workspaceId: snapshot.workspaceId,
  projectId: snapshot.projectId,
  basketId: snapshot.basket.id,
  scenarioId: snapshot.scenario.id,
  expectedRevision: snapshot.strategyBinding.revision,
  expectedTiming: snapshot.strategyBinding.timing,
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const copy = () => clone(input);
function mock(result: unknown = { data: [fixture], error: null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { rpc, client: { rpc } as unknown as SupabaseClient };
}

describe("BSK-09 timed approval review connection", () => {
  it("retains actual SQL dates, strategy, creators, fees and fingerprint", async () => {
    const { client, rpc } = mock();
    expect(await previewTimedBasketApproval(client, input)).toEqual({
      snapshot,
      snapshotHash: fixture.review_snapshot_hash,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "preview_timed_basket_strategy_approval",
      {
        target_workspace_id: input.workspaceId,
        target_project_id: input.projectId,
        target_basket_id: input.basketId,
        target_scenario_id: input.scenarioId,
        expected_strategy_revision: input.expectedRevision,
      },
    );
  });
  it("normalizes requested UUID case but does not rewrite retained data", async () => {
    const request = {
      ...input,
      basketId: input.basketId.toUpperCase(),
      scenarioId: input.scenarioId.toUpperCase(),
    };
    expect(
      (await previewTimedBasketApproval(mock().client, request)).snapshot,
    ).toEqual(snapshot);
  });
  it.each(["workspaceId", "projectId", "basketId", "scenarioId"] as const)(
    "rejects a different %s",
    async (key) => {
      await expect(
        previewTimedBasketApproval(mock().client, {
          ...input,
          [key]: "99999999-0000-4000-8000-000000000001",
        }),
      ).rejects.toMatchObject({ code: "changed" });
    },
  );
  it("rejects a different saved revision", async () => {
    await expect(
      previewTimedBasketApproval(mock().client, {
        ...input,
        expectedRevision: input.expectedRevision + 1,
      }),
    ).rejects.toMatchObject({ code: "changed" });
  });
  it.each([
    ["flight", "startedAt"],
    ["flight", "endedAt"],
    ["measurement", "startedAt"],
    ["measurement", "endedAt"],
  ] as const)(
    "rejects microsecond drift in %s.%s",
    async (period, boundary) => {
      const request = copy();
      // Expand measurement outward, move flight inward to keep proposals valid.
      const earlier =
        (period === "measurement" && boundary === "startedAt") ||
        (period === "flight" && boundary === "endedAt");
      const value = request.expectedTiming[period][boundary];
      request.expectedTiming[period][boundary] = earlier
        ? new Date(Date.parse(value) - 1)
            .toISOString()
            .replace(".999Z", ".999999Z")
        : value.replace(/(?:\.\d+)?Z$/, ".000001Z");
      await expect(
        previewTimedBasketApproval(mock().client, request),
      ).rejects.toMatchObject({ code: "changed" });
    },
  );
  it("accepts equivalent fractional padding", async () => {
    const request = copy();
    for (const period of ["flight", "measurement"] as const)
      for (const boundary of ["startedAt", "endedAt"] as const)
        request.expectedTiming[period][boundary] = request.expectedTiming[
          period
        ][boundary].replace(/(?:\.0+)?Z$/, ".000000Z");
    expect(
      (await previewTimedBasketApproval(mock().client, request)).snapshot,
    ).toEqual(snapshot);
  });
  it.each([
    null,
    {},
    { ...input, expectedRevision: 0 },
    { ...input, expectedTiming: null },
    { ...input, confirmation: true },
  ])("rejects invalid input before any call", async (request) => {
    const { client, rpc } = mock();
    await expect(
      previewTimedBasketApproval(client, request),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {},
    { data: [fixture] },
    { data: null, error: null },
    { data: [], error: null },
    { data: [fixture, fixture], error: null },
    { data: [{ ...fixture, review_snapshot_hash: "invalid" }], error: null },
    { data: [fixture], error: {} },
  ])("rejects incomplete or ambiguous responses", async (result) => {
    await expect(
      previewTimedBasketApproval(mock(result).client, input),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
  it.each(["42501", "40001", "22023", "55000", "XX000"])(
    "sanitizes %s without retry or legacy fallback",
    async (code) => {
      const { client, rpc } = mock({
        data: [fixture],
        error: { code, message: "private provider details" },
      });
      await expect(
        previewTimedBasketApproval(client, input),
      ).rejects.toMatchObject({
        code:
          code === "42501"
            ? "forbidden"
            : code === "XX000"
              ? "unavailable"
              : "changed",
        message: "The saved campaign plan could not be confirmed for review.",
      });
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );
  it("sanitizes thrown failures", async () => {
    const { client, rpc } = mock();
    rpc.mockRejectedValue(new Error("private transport details"));
    await expect(
      previewTimedBasketApproval(client, input),
    ).rejects.toMatchObject({
      code: "unavailable",
      message: "The saved campaign plan could not be confirmed for review.",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects older bindings rather than dropping dates", async () => {
    const row = clone(fixture);
    row.review_snapshot.strategyBinding.schemaVersion = 1;
    await expect(
      previewTimedBasketApproval(
        mock({ data: [row], error: null }).client,
        input,
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});

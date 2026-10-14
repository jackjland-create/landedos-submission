import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBasketTiming, saveBasketTiming } from "./basket-timing";
import savedTiming from "./fixtures/bsk09-basket-timing.json";

const scope = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  projectId: "20000000-0000-4000-8000-000000000001",
  basketId: "90000000-0000-4000-8000-000000000001",
};
const timing = {
  schemaVersion: 1,
  flight: {
    startedAt: "2026-09-14T00:00:00Z",
    endedAt: "2026-10-12T00:00:00Z",
  },
  measurement: {
    startedAt: "2026-09-14T00:00:00Z",
    endedAt: "2026-11-12T00:00:00Z",
  },
};
const row = {
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
  basket_id: scope.basketId,
  revision: 3,
  timing,
};
function clientFor(data: unknown, error: unknown = null) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  const from = vi.fn().mockReturnValue(chain);
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    client: { from, rpc } as unknown as SupabaseClient,
    from,
    rpc,
    chain,
  };
}
describe("BSK-09 staged basket timing adapters", () => {
  it("decodes the actual isolated SQL saved timing row", async () => {
    expect(
      await loadBasketTiming(clientFor(savedTiming).client, {
        workspaceId: savedTiming.workspace_id,
        projectId: savedTiming.project_id,
        basketId: savedTiming.basket_id,
      }),
    ).toEqual({ revision: savedTiming.revision, timing: savedTiming.timing });
  });
  it("normalizes requested UUID case before comparing database scope", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const m = clientFor({ ...row, basket_id: id });
    expect(
      await loadBasketTiming(m.client, {
        ...scope,
        basketId: id.toUpperCase(),
      }),
    ).toEqual({ revision: 3, timing });
    expect(m.chain.eq).toHaveBeenCalledWith("basket_id", id);
  });
  it("rejects missing error envelopes rather than confirming absence or a save", async () => {
    const m = clientFor(null);
    m.chain.maybeSingle.mockResolvedValue({ data: null });
    m.rpc.mockResolvedValue({ data: 4 });
    await expect(loadBasketTiming(m.client, scope)).rejects.toMatchObject({
      outcome: "unconfirmed",
    });
    await expect(
      saveBasketTiming(m.client, { ...scope, expectedRevision: 3, timing }),
    ).rejects.toMatchObject({ outcome: "unconfirmed" });
  });
  it("reads timing and shared revision once with exact scope", async () => {
    const m = clientFor(row);
    expect(await loadBasketTiming(m.client, scope)).toEqual({
      revision: 3,
      timing,
    });
    expect(m.chain.eq.mock.calls).toEqual([
      ["workspace_id", scope.workspaceId],
      ["project_id", scope.projectId],
      ["basket_id", scope.basketId],
    ]);
    expect(m.chain.maybeSingle).toHaveBeenCalledTimes(1);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("preserves unset timing without inventing dates", async () => {
    expect(
      await loadBasketTiming(clientFor({ ...row, timing: null }).client, scope),
    ).toEqual({ revision: 3, timing: null });
  });
  it("does not fabricate a missing or hidden strategy", async () => {
    expect(await loadBasketTiming(clientFor(null).client, scope)).toBeNull();
  });
  it.each(["workspace_id", "project_id", "basket_id"])(
    "rejects mismatched %s",
    async (key) => {
      await expect(
        loadBasketTiming(
          clientFor({ ...row, [key]: "80000000-0000-4000-8000-000000000001" })
            .client,
          scope,
        ),
      ).rejects.toMatchObject({ outcome: "unconfirmed" });
    },
  );
  it("does not drop missing timing in malformed output", async () => {
    await expect(
      loadBasketTiming(clientFor({ ...row, timing: undefined }).client, scope),
    ).rejects.toMatchObject({ outcome: "unconfirmed" });
  });
  it.each([timing, null])(
    "saves or clears timing with revision and scope, never retries",
    async (value) => {
      const m = clientFor(4);
      expect(
        await saveBasketTiming(m.client, {
          ...scope,
          expectedRevision: 3,
          timing: value,
        }),
      ).toEqual({ revision: 4 });
      expect(m.rpc).toHaveBeenCalledExactlyOnceWith("save_basket_timing", {
        target_workspace_id: scope.workspaceId,
        target_project_id: scope.projectId,
        target_basket_id: scope.basketId,
        expected_revision: 3,
        next_timing: value,
      });
      expect(m.from).not.toHaveBeenCalled();
    },
  );
  it.each([3, 5, null, "4"])(
    "rejects an unexpected revision receipt %s",
    async (value) => {
      const m = clientFor(value);
      await expect(
        saveBasketTiming(m.client, { ...scope, expectedRevision: 3, timing }),
      ).rejects.toMatchObject({ outcome: "unconfirmed" });
      expect(m.rpc).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["40001", "PT409"])(
    "sanitizes database conflict %s without retry",
    async (code) => {
      const m = clientFor(null, { code, message: "private detail" });
      await expect(
        saveBasketTiming(m.client, { ...scope, expectedRevision: 3, timing }),
      ).rejects.toThrow("Basket timing could not be confirmed.");
      expect(m.rpc).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects invalid input before reads or writes", async () => {
    const m = clientFor(null);
    await expect(
      saveBasketTiming(m.client, { ...scope, expectedRevision: 0, timing }),
    ).rejects.toMatchObject({ outcome: "not_started" });
    await expect(
      loadBasketTiming(m.client, { ...scope, basketId: "bad" }),
    ).rejects.toMatchObject({ outcome: "not_started" });
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.from).not.toHaveBeenCalled();
  });
});

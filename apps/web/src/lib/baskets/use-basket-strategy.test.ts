import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  draftCustomBasket,
  draftFromPreparedBasket,
  getPreparedBasket,
  type SavedBasketStrategy,
} from "@landed/contracts";
import { useBasketStrategy } from "./use-basket-strategy";
import { StrategyClientError } from "./strategy-client";

const basketId = "90000000-0000-4000-8000-000000000001";
const creatorId = "40000000-0000-4000-8000-000000000001";
const record = (): SavedBasketStrategy => ({
  basketId,
  revision: 1,
  persistence: "saved",
  draft: draftCustomBasket({ name: "Investor plan" }),
});
const clientFor = (saved = record()) => ({
  load: vi.fn().mockResolvedValue(saved),
  save: vi.fn().mockResolvedValue(saved.revision + 1),
  addCreators: vi.fn().mockResolvedValue(saved.revision + 1),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(cleanup);

describe("BSK-08 editor session", () => {
  it("loads a saved draft without inventing measurement or creators", async () => {
    const client = clientFor();
    const { result } = renderHook(() => useBasketStrategy(client));
    expect(result.current.state.busy).toBe("loading");
    await waitFor(() => expect(result.current.state.saved).toEqual(record()));
    expect(result.current.dirty).toBe(false);
    expect(result.current.state.edits?.strategy.measurement).toBeNull();
  });
  it("retains prepared provenance and all untouched strategy when saving", async () => {
    const saved = {
      ...record(),
      draft: draftFromPreparedBasket(getPreparedBasket("investor_reach", 1)!),
    };
    const client = clientFor(saved);
    const { result } = renderHook(() => useBasketStrategy(client));
    await waitFor(() => expect(result.current.state.busy).toBeNull());
    act(() =>
      result.current.edit({
        ...result.current.state.edits!,
        name: "My investors",
      }),
    );
    expect(result.current.dirty).toBe(true);
    await act(async () => {
      expect(await result.current.save()).toBe(true);
    });
    expect(result.current.state.saved?.draft.origin).toEqual(
      saved.draft.origin,
    );
    expect(result.current.state.saved?.draft.strategy).toEqual(
      saved.draft.strategy,
    );
    expect(result.current.state.saved?.revision).toBe(2);
    expect(result.current.dirty).toBe(false);
    expect(client.save).toHaveBeenCalledWith({
      name: "My investors",
      strategy: saved.draft.strategy,
      expectedRevision: 1,
    });
  });
  it("keeps local edits after conflict and requires explicit saved-version acceptance", async () => {
    const client = clientFor();
    client.save.mockRejectedValue(new StrategyClientError("conflict"));
    const { result } = renderHook(() => useBasketStrategy(client));
    await waitFor(() => expect(result.current.state.busy).toBeNull());
    act(() =>
      result.current.edit({
        ...result.current.state.edits!,
        name: "Local work",
      }),
    );
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    expect(result.current.state.edits?.name).toBe("Local work");
    expect(result.current.state.needsReview).toBe(true);
    const latest = {
      ...record(),
      revision: 3,
      draft: { ...record().draft, name: "Another operator" },
    };
    client.load.mockResolvedValue(latest);
    await act(async () => {
      await result.current.reviewSaved();
    });
    expect(result.current.state.edits?.name).toBe("Local work");
    expect(result.current.state.latest).toEqual(latest);
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    expect(client.save).toHaveBeenCalledTimes(1);
    act(() => result.current.useSavedVersion());
    expect(result.current.state.edits?.name).toBe("Another operator");
    expect(result.current.state.saved?.revision).toBe(3);
    expect(result.current.dirty).toBe(false);
  });
  it.each(["permission", "unavailable"] as const)(
    "does not resubmit after %s",
    async (kind) => {
      const client = clientFor();
      client.save.mockRejectedValue(new StrategyClientError(kind));
      const { result } = renderHook(() => useBasketStrategy(client));
      await waitFor(() => expect(result.current.state.busy).toBeNull());
      act(() =>
        result.current.edit({
          ...result.current.state.edits!,
          name: "Retained",
        }),
      );
      await act(async () => {
        await result.current.save();
        await result.current.save();
      });
      expect(client.save).toHaveBeenCalledTimes(1);
      expect(result.current.state.edits?.name).toBe("Retained");
      expect(result.current.state.error?.kind).toBe(kind);
    },
  );
  it("blocks duplicate writes and edits while a save is in flight", async () => {
    const client = clientFor();
    const pending = deferred<number>();
    client.save.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useBasketStrategy(client));
    await waitFor(() => expect(result.current.state.busy).toBeNull());
    let first!: Promise<boolean>;
    act(() => {
      first = result.current.save();
    });
    await act(async () => {
      expect(await result.current.save()).toBe(false);
      result.current.edit({ ...result.current.state.edits!, name: "Race" });
      pending.resolve(2);
      await first;
    });
    expect(client.save).toHaveBeenCalledTimes(1);
    expect(result.current.state.edits?.name).toBe("Investor plan");
  });
  it("does not add creators before unsaved strategy edits are saved", async () => {
    const client = clientFor();
    const { result } = renderHook(() => useBasketStrategy(client));
    await waitFor(() => expect(result.current.state.busy).toBeNull());
    act(() =>
      result.current.edit({ ...result.current.state.edits!, name: "Unsaved" }),
    );
    await act(async () => {
      expect(await result.current.addCreators([creatorId])).toBe(false);
    });
    expect(client.addCreators).not.toHaveBeenCalled();
  });
  it("appends to the same saved basket without replacing strategy or provenance", async () => {
    const client = clientFor();
    const { result } = renderHook(() => useBasketStrategy(client));
    await waitFor(() => expect(result.current.state.busy).toBeNull());
    await act(async () => {
      expect(await result.current.addCreators([creatorId])).toBe(true);
    });
    expect(client.addCreators).toHaveBeenCalledWith({
      expectedRevision: 1,
      creatorIds: [creatorId],
    });
    expect(result.current.state.saved).toEqual({
      ...record(),
      revision: 2,
      draft: { ...record().draft, selectedCreatorIds: [creatorId] },
    });
    expect(client.save).not.toHaveBeenCalled();
  });
  it("requires an explicit strategy save for a legacy shortlist", async () => {
    const legacy: SavedBasketStrategy = {
      ...record(),
      revision: 0,
      persistence: "legacy_unconfigured",
    };
    const client = clientFor(legacy);
    const { result } = renderHook(() => useBasketStrategy(client));
    await waitFor(() => expect(result.current.state.busy).toBeNull());
    await act(async () => {
      expect(await result.current.addCreators([creatorId])).toBe(false);
    });
    expect(client.save).not.toHaveBeenCalled();
    await act(async () => {
      expect(await result.current.save()).toBe(true);
    });
    expect(result.current.state.saved?.persistence).toBe("saved");
    expect(client.save).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 0 }),
    );
  });
  it("ignores a previous basket's late load", async () => {
    const first = clientFor();
    const pending = deferred<SavedBasketStrategy>();
    first.load.mockReturnValue(pending.promise);
    const secondRecord = { ...record(), basketId: creatorId };
    const second = clientFor(secondRecord);
    const { result, rerender } = renderHook(
      ({ client }) => useBasketStrategy(client),
      { initialProps: { client: first } },
    );
    rerender({ client: second });
    await waitFor(() =>
      expect(result.current.state.saved?.basketId).toBe(creatorId),
    );
    await act(async () => {
      pending.resolve(record());
      await pending.promise;
    });
    expect(result.current.state.saved?.basketId).toBe(creatorId);
  });
  it("allows a failed initial read to be retried", async () => {
    const client = clientFor();
    client.load.mockRejectedValueOnce(new StrategyClientError("unavailable"));
    const { result } = renderHook(() => useBasketStrategy(client));
    await waitFor(() =>
      expect(result.current.state.error?.kind).toBe("unavailable"),
    );
    await act(async () => {
      await result.current.reviewSaved();
    });
    expect(result.current.state.saved).toEqual(record());
  });
  it("rejects callbacks retained from a previous basket session", async () => {
    const first = clientFor();
    const second = clientFor({ ...record(), basketId: creatorId });
    const { result, rerender } = renderHook(
      ({ client }) => useBasketStrategy(client),
      { initialProps: { client: first } },
    );
    await waitFor(() => expect(result.current.state.busy).toBeNull());
    const old = result.current;
    rerender({ client: second });
    await waitFor(() =>
      expect(result.current.state.saved?.basketId).toBe(creatorId),
    );
    await act(async () => {
      expect(await old.save()).toBe(false);
      expect(await old.addCreators([creatorId])).toBe(false);
      await old.reviewSaved();
      old.edit({ ...old.state.edits!, name: "Stale callback" });
      old.useSavedVersion();
    });
    expect(first.save).not.toHaveBeenCalled();
    expect(first.addCreators).not.toHaveBeenCalled();
    expect(first.load).toHaveBeenCalledTimes(1);
    expect(result.current.state.saved?.basketId).toBe(creatorId);
    expect(result.current.state.edits?.name).toBe("Investor plan");
  });
  it("reconciles the submitted creator IDs, not a caller's later mutation", async () => {
    const client = clientFor();
    const pending = deferred<number>();
    client.addCreators.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useBasketStrategy(client));
    await waitFor(() => expect(result.current.state.busy).toBeNull());
    const ids = [creatorId];
    let adding!: Promise<boolean>;
    act(() => {
      adding = result.current.addCreators(ids);
    });
    ids[0] = basketId;
    await act(async () => {
      pending.resolve(2);
      await adding;
    });
    expect(result.current.state.saved?.draft.selectedCreatorIds).toEqual([
      creatorId,
    ]);
    expect(client.addCreators).toHaveBeenCalledWith({
      expectedRevision: 1,
      creatorIds: [creatorId],
    });
  });
  it("ignores a save completion after navigating to another basket", async () => {
    const first = clientFor();
    const pending = deferred<number>();
    first.save.mockReturnValue(pending.promise);
    const second = clientFor({ ...record(), basketId: creatorId });
    const { result, rerender } = renderHook(
      ({ client }) => useBasketStrategy(client),
      { initialProps: { client: first } },
    );
    await waitFor(() => expect(result.current.state.busy).toBeNull());
    let saving!: Promise<boolean>;
    act(() => {
      saving = result.current.save();
    });
    rerender({ client: second });
    await waitFor(() =>
      expect(result.current.state.saved?.basketId).toBe(creatorId),
    );
    await act(async () => {
      pending.resolve(2);
      expect(await saving).toBe(false);
    });
    expect(result.current.state.saved?.revision).toBe(1);
    expect(result.current.state.saved?.basketId).toBe(creatorId);
  });
});

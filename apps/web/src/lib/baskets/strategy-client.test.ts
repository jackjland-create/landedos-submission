import { describe, expect, it, vi } from "vitest";
import { draftCustomBasket } from "@landed/contracts";
import { basketStrategyClient } from "./strategy-client";

const basketId = "90000000-0000-4000-8000-000000000001";
const creatorId = "40000000-0000-4000-8000-000000000001";
const saved = {
  basketId,
  revision: 1,
  persistence: "saved",
  draft: draftCustomBasket({ name: "Investor plan" }),
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("BSK-08 browser transport", () => {
  it("binds an editor save to its expected authenticated owner", async () => {
    const request = vi.fn().mockResolvedValue(response({ revision: 2 }));
    await basketStrategyClient("helios", basketId, request, creatorId).save({
      expectedRevision: 1,
      name: saved.draft.name,
      strategy: saved.draft.strategy,
    });
    expect(JSON.parse(request.mock.calls[0]![1].body)).toMatchObject({
      expectedOwnerId: creatorId,
      expectedRevision: 1,
    });
  });
  it("reads the exact basket privately with same-origin credentials", async () => {
    const request = vi.fn().mockResolvedValue(response(saved));
    expect(
      await basketStrategyClient("helios", basketId, request).load(),
    ).toEqual(saved);
    expect(request).toHaveBeenCalledWith(
      `/api/projects/helios/baskets/${basketId}/strategy`,
      {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
      },
    );
  });
  it.each(["../other", "https://evil.test", "a/b", ""])(
    "rejects unsafe project context %s",
    (project) => {
      expect(() => basketStrategyClient(project, basketId)).toThrow();
    },
  );
  it.each([
    { ...saved, basketId: creatorId },
    { ...saved, revision: 0 },
    { ...saved, persistence: "legacy_unconfigured" },
    { ...saved, draft: { name: "Missing fields" } },
  ])("rejects mismatched or malformed successful reads", async (body) => {
    const request = vi.fn().mockResolvedValue(response(body));
    await expect(
      basketStrategyClient("helios", basketId, request).load(),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });
  it.each([
    [401, "permission"],
    [403, "permission"],
    [404, "not_found"],
    [409, "conflict"],
    [400, "invalid"],
    [500, "unavailable"],
  ])("maps %s without exposing response text", async (status, kind) => {
    const request = vi
      .fn()
      .mockResolvedValue(
        response({ message: "private provider details" }, Number(status)),
      );
    await expect(
      basketStrategyClient("helios", basketId, request).load(),
    ).rejects.toMatchObject({ kind });
  });
  it("sends only editable strategy fields and the checked revision", async () => {
    const request = vi.fn().mockResolvedValue(response({ revision: 2 }));
    const client = basketStrategyClient("helios", basketId, request);
    const input = {
      expectedRevision: 1,
      name: "  Updated plan  ",
      strategy: saved.draft.strategy,
    };
    expect(await client.save(input)).toBe(2);
    expect(JSON.parse(request.mock.calls[0]![1].body)).toEqual({
      ...input,
      name: "Updated plan",
    });
  });
  it("rejects invalid selections before any write", async () => {
    const request = vi.fn();
    const client = basketStrategyClient("helios", basketId, request);
    await expect(
      client.addCreators({
        expectedRevision: 1,
        creatorIds: [creatorId, creatorId],
      }),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(
      client.addCreators({ expectedRevision: 0, creatorIds: [creatorId] }),
    ).rejects.toMatchObject({ kind: "invalid" });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([{}, { revision: 1 }, { revision: 3 }])(
    "does not accept an unconfirmed mutation revision",
    async (body) => {
      const request = vi.fn().mockResolvedValue(response(body));
      await expect(
        basketStrategyClient("helios", basketId, request).addCreators({
          expectedRevision: 1,
          creatorIds: [creatorId],
        }),
      ).rejects.toMatchObject({ kind: "unavailable" });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
  it("never retries an ambiguous network write", async () => {
    const request = vi.fn().mockRejectedValue(new TypeError("network"));
    await expect(
      basketStrategyClient("helios", basketId, request).save({
        expectedRevision: 1,
        name: "Plan",
        strategy: saved.draft.strategy,
      }),
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

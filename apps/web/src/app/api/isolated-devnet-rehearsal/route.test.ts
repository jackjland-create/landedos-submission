// @vitest-environment node
// HTTP gates only: no Auth, database, provider or wallet action occurs.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  run: vi.fn(),
  client: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/inngest/client", () => ({ inngest: { send: mocks.send } }));
vi.mock(
  "@/lib/attribution/devnet-campaign-runtime.server",
  async (original) => {
    const actual =
      await original<
        typeof import("@/lib/attribution/devnet-campaign-runtime.server")
      >();
    return {
      ...actual,
      assertLocalDevnetRehearsalHost: mocks.gate,
      runLocalDevnetAction: async (client: unknown, input: unknown) =>
        mocks.run(client, actual.localDevnetActionSchema.parse(input)),
    };
  },
);

import * as route from "./route";

const origin = "http://127.0.0.1:3210";
const id = "90000000-0000-4000-8000-000000000001";

function request(
  method: "GET" | "POST",
  input: Record<string, unknown>,
  headers: Record<string, string> = {},
  raw?: string,
) {
  return new NextRequest(
    origin +
      "/api/isolated-devnet-rehearsal" +
      (method === "GET"
        ? `?${new URLSearchParams(input as Record<string, string>)}`
        : ""),
    {
      method,
      headers: {
        host: "127.0.0.1:3210",
        origin,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        ...headers,
      },
      ...(method === "POST" ? { body: raw ?? JSON.stringify(input) } : {}),
    },
  );
}

const prepare = {
  action: "prepare",
  campaignId: id,
  reconciliationJobId: id,
};
const recover = { action: "recover", campaignId: id, reviewId: id };
const readActivation = { action: "readActivation", campaignId: id };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({});
  mocks.run.mockResolvedValue({ status: "not_recorded" });
});

describe("isolated local devnet HTTP boundary", () => {
  const enqueue = {
    action: "enqueueReconciliation",
    campaignId: id,
    mappingId: id,
    integrationId: id,
    reconciliationJobId: id,
    reconciliationRequestId: id,
  };
  it.each(["queued", "running"])(
    "dispatches only a retained %s closed-range job",
    async (status) => {
      mocks.run.mockResolvedValue({ job_id: id, status, inserted: false });
      const response = await route.POST(request("POST", enqueue));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        job_id: id,
        status,
        inserted: false,
        dispatch: "accepted",
      });
      expect(mocks.send).toHaveBeenCalledWith({
        id: `local-devnet-closed-${id}`,
        name: "landed/solana.reconciliation.requested",
        data: { jobId: id },
      });
      expect(mocks.run).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["completed", "failed"])(
    "does not reopen a %s job",
    async (status) => {
      mocks.run.mockResolvedValue({ job_id: id, status, inserted: false });
      const response = await route.POST(request("POST", enqueue));
      expect((await response.json()).dispatch).toBe("not_needed");
      expect(mocks.send).not.toHaveBeenCalled();
    },
  );
  it("preserves the exact durable job after uncertain dispatch", async () => {
    mocks.run.mockResolvedValue({
      job_id: id,
      status: "queued",
      inserted: true,
    });
    mocks.send.mockRejectedValue(new Error("private transport detail"));
    const response = await route.POST(request("POST", enqueue));
    expect(await response.json()).toEqual({
      job_id: id,
      status: "queued",
      inserted: true,
      dispatch: "unconfirmed",
    });
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch a changed retained job identity", async () => {
    mocks.run.mockResolvedValue({
      job_id: "90000000-0000-4000-8000-000000000002",
      status: "queued",
      inserted: true,
    });
    expect((await route.POST(request("POST", enqueue))).status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("keeps closed-range reads read-only and rejects caller receipts", async () => {
    const input = {
      action: "readReconciliation",
      campaignId: id,
      reconciliationJobId: id,
    };
    expect((await route.GET(request("GET", input))).status).toBe(200);
    expect((await route.POST(request("POST", input))).status).toBe(409);
    expect((await route.GET(request("GET", enqueue))).status).toBe(409);
    expect(
      (
        await route.POST(
          request("POST", { ...enqueue, quiescenceReceipt: "a".repeat(64) }),
        )
      ).status,
    ).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([
    { origin: "" },
    { origin: "https://outsider.test" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
  ])("rejects hostile or missing origin metadata: %j", async (headers) => {
    const input = request("POST", prepare, headers);
    if (headers.origin === "") input.headers.delete("origin");
    const response = await route.POST(input);
    expect(response.status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("hides a disabled runtime before parsing or opening Auth", async () => {
    mocks.gate.mockImplementation(() => {
      throw Error("disabled");
    });
    const response = await route.POST(request("POST", prepare, {}, "invalid"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each(["GET-write", "POST-read", "unknown"])(
    "rejects wrong method/action: %s",
    async (kind) => {
      const response =
        kind === "GET-write"
          ? await route.GET(request("GET", prepare))
          : await route.POST(
              request(
                "POST",
                kind === "POST-read" ? recover : { action: "invented" },
              ),
            );
      expect(response.status).toBe(409);
      expect(mocks.run).not.toHaveBeenCalled();
    },
  );

  it.each(["bad-json", "too-large", "wrong-content"])(
    "rejects malformed input: %s",
    async (kind) => {
      const response = await route.POST(
        request(
          "POST",
          prepare,
          kind === "wrong-content" ? { "content-type": "text/plain" } : {},
          kind === "bad-json"
            ? "{"
            : kind === "too-large"
              ? " ".repeat(16_001)
              : undefined,
        ),
      );
      expect(response.status).toBe(409);
      expect(mocks.client).not.toHaveBeenCalled();
    },
  );

  it("rejects caller-owned evidence and destination overrides", async () => {
    for (const field of [
      "actorId",
      "destinationUrl",
      "candidates",
      "quiescenceReceipt",
    ]) {
      const response = await route.POST(
        request("POST", { ...prepare, [field]: id }),
      );
      expect(response.status).toBe(409);
    }
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("sanitizes runtime failures and never retries", async () => {
    mocks.run.mockRejectedValue(Error("private database detail"));
    const response = await route.POST(request("POST", prepare));
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("private database detail");
    expect(mocks.client).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });

  it("permits only non-writing recovery over GET", async () => {
    const response = await route.GET(request("GET", recover));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });

  it("reads activation state over GET and keeps commercial writes on POST", async () => {
    const read = await route.GET(request("GET", readActivation));
    expect(read.status).toBe(200);
    const prepareCommercial = {
      action: "prepareCommercial",
      basketId: id,
      scenarioId: id,
      revision: 3,
    };
    const write = await route.POST(request("POST", prepareCommercial));
    expect(write.status).toBe(200);
    expect(mocks.run).toHaveBeenCalledTimes(2);
  });
});

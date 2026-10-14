import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "../../../../../packages/solana/src/fixtures/helius-enhanced-transfer.json";

import {
  fetchHeliusHistoricalPage,
  HeliusHistoricalConfigError,
  HeliusHistoricalFetchError,
} from "./historical.server";

const address = fixture.accountData[0]!.account;

describe("Helius historical pages", () => {
  beforeEach(() => {
    process.env.HELIUS_API_KEY = "test-helius-key-with-at-least-20-characters";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete process.env.HELIUS_API_KEY;
    delete process.env.LANDED_LOCAL_DEVNET_REHEARSAL;
    delete process.env.LANDED_LOCAL_SYNTHETIC_HELIUS_HISTORY_URL;
    delete process.env.LANDED_EXTERNAL_DEVNET_SESSION;
  });

  it("uses real Helius in the supervised production-built isolated devnet app", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.LANDED_LOCAL_DEVNET_REHEARSAL = "1";
    process.env.LANDED_EXTERNAL_DEVNET_SESSION = "1";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return new Response("[]");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchHeliusHistoricalPage({
        address,
        beforeSignature: null,
        environment: "devnet",
        rangeStartedAt: "2026-10-06T18:00:00.000Z",
        rangeEndedAt: "2026-10-06T18:01:00.000Z",
      }),
    ).resolves.toMatchObject({ transactions: [], hasMore: false });
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).origin).toBe(
      "https://api-devnet.helius-rpc.com",
    );
  });

  it.each(["synthetic", "hosted", "missing-isolation", "demo", "mainnet"])(
    "rejects %s in the supervised provider gate before any fetch",
    async (conflict) => {
      vi.stubEnv("NODE_ENV", "production");
      process.env.LANDED_LOCAL_DEVNET_REHEARSAL = "1";
      process.env.LANDED_EXTERNAL_DEVNET_SESSION = "1";
      if (conflict === "synthetic")
        process.env.LANDED_LOCAL_SYNTHETIC_HELIUS_HISTORY_URL =
          "http://127.0.0.1:39492";
      if (conflict === "hosted") vi.stubEnv("VERCEL", "1");
      if (conflict === "missing-isolation")
        delete process.env.LANDED_LOCAL_DEVNET_REHEARSAL;
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        fetchHeliusHistoricalPage({
          address,
          beforeSignature: null,
          environment:
            conflict === "demo"
              ? "demo"
              : conflict === "mainnet"
                ? "mainnet"
                : "devnet",
          rangeStartedAt: "2026-10-06T18:00:00.000Z",
          rangeEndedAt: "2026-10-06T18:01:00.000Z",
        }),
      ).rejects.toBeInstanceOf(HeliusHistoricalConfigError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["production", "hosted"])(
    "keeps synthetic history prohibited in %s",
    async (mode) => {
      process.env.LANDED_LOCAL_DEVNET_REHEARSAL = "1";
      process.env.LANDED_LOCAL_SYNTHETIC_HELIUS_HISTORY_URL =
        "http://127.0.0.1:39492";
      if (mode === "production") vi.stubEnv("NODE_ENV", "production");
      else vi.stubEnv("VERCEL_ENV", "preview");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        fetchHeliusHistoricalPage({
          address,
          beforeSignature: null,
          environment: "devnet",
          rangeStartedAt: "2026-10-06T18:00:00.000Z",
          rangeEndedAt: "2026-10-06T18:01:00.000Z",
        }),
      ).rejects.toBeInstanceOf(HeliusHistoricalConfigError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("requests one bounded finalized page inside the consent window", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      const body = JSON.stringify([fixture]);
      return new Response(body, {
        headers: {
          "Content-Length": String(new TextEncoder().encode(body).length),
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = await fetchHeliusHistoricalPage({
      address,
      beforeSignature: null,
      environment: "devnet",
      rangeEndedAt: "2026-08-12T12:00:00.000Z",
      rangeStartedAt: "2026-05-14T12:00:00.000Z",
    });

    expect(page.transactions).toHaveLength(1);
    expect(page.hasMore).toBe(false);
    const requestedUrl = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(requestedUrl.origin).toBe("https://api-devnet.helius-rpc.com");
    expect(requestedUrl.searchParams.get("commitment")).toBe("finalized");
    expect(requestedUrl.searchParams.get("token-accounts")).toBe(
      "balanceChanged",
    );
    expect(requestedUrl.searchParams.get("limit")).toBe("100");
    expect(requestedUrl.searchParams.get("gte-time")).toBe("1778760000");
    expect(requestedUrl.searchParams.get("api-key")).not.toBeNull();
  });

  it("accepts an empty terminal page and rounds the lower bound inward", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return new Response("[]", { headers: { "Content-Length": "2" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchHeliusHistoricalPage({
        address,
        beforeSignature: fixture.signature,
        environment: "devnet",
        rangeEndedAt: "2026-08-12T12:00:00.999Z",
        rangeStartedAt: "2026-05-14T12:00:00.999Z",
      }),
    ).resolves.toMatchObject({
      hasMore: false,
      nextBeforeSignature: null,
      transactions: [],
    });

    const requestedUrl = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(requestedUrl.searchParams.get("gte-time")).toBe("1778760001");
    expect(requestedUrl.searchParams.get("lte-time")).toBe("1786536000");
  });

  it("uses a loopback provider only inside the explicit local rehearsal gate", async () => {
    process.env.LANDED_LOCAL_DEVNET_REHEARSAL = "1";
    process.env.LANDED_LOCAL_SYNTHETIC_HELIUS_HISTORY_URL =
      "http://127.0.0.1:39492";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return new Response("[]", { headers: { "Content-Length": "2" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchHeliusHistoricalPage({
      address,
      beforeSignature: null,
      environment: "devnet",
      rangeEndedAt: "2026-08-12T12:00:00.000Z",
      rangeStartedAt: "2026-05-14T12:00:00.000Z",
    });
    expect(new URL(String(fetchMock.mock.calls[0]![0])).origin).toBe(
      "http://127.0.0.1:39492",
    );

    process.env.LANDED_LOCAL_SYNTHETIC_HELIUS_HISTORY_URL =
      "http://provider.example.test";
    await expect(
      fetchHeliusHistoricalPage({
        address,
        beforeSignature: null,
        environment: "devnet",
        rangeEndedAt: "2026-08-12T12:00:00.000Z",
        rangeStartedAt: "2026-05-14T12:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(HeliusHistoricalConfigError);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    delete process.env.LANDED_LOCAL_SYNTHETIC_HELIUS_HISTORY_URL;
    await expect(
      fetchHeliusHistoricalPage({
        address,
        beforeSignature: null,
        environment: "devnet",
        rangeEndedAt: "2026-08-12T12:00:00.000Z",
        rangeStartedAt: "2026-05-14T12:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(HeliusHistoricalConfigError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed for mainnet, an unbounded window or oversized response", async () => {
    await expect(
      fetchHeliusHistoricalPage({
        address,
        beforeSignature: null,
        environment: "mainnet",
        rangeEndedAt: "2026-08-12T12:00:00.000Z",
        rangeStartedAt: "2026-05-14T12:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(HeliusHistoricalConfigError);

    await expect(
      fetchHeliusHistoricalPage({
        address,
        beforeSignature: null,
        environment: "devnet",
        rangeEndedAt: "2026-08-12T12:00:00.000Z",
        rangeStartedAt: "2026-01-01T12:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(HeliusHistoricalFetchError);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("[]", {
            headers: { "Content-Length": "1000001" },
          }),
      ),
    );
    await expect(
      fetchHeliusHistoricalPage({
        address,
        beforeSignature: null,
        environment: "devnet",
        rangeEndedAt: "2026-08-12T12:00:00.000Z",
        rangeStartedAt: "2026-05-14T12:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(HeliusHistoricalFetchError);
  });

  it("rejects a full provider page whose cursor does not advance", async () => {
    const body = JSON.stringify(
      Array.from({ length: 100 }, () => ({ ...fixture })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, {
            headers: {
              "Content-Length": String(new TextEncoder().encode(body).length),
            },
          }),
      ),
    );

    await expect(
      fetchHeliusHistoricalPage({
        address,
        beforeSignature: fixture.signature,
        environment: "devnet",
        rangeEndedAt: "2026-08-12T12:00:00.000Z",
        rangeStartedAt: "2026-05-14T12:00:00.000Z",
      }),
    ).rejects.toThrow("cursor did not advance");
  });
});

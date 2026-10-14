import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
vi.mock("server-only", () => ({}));
import { observeDevnetOperatorEntry } from "./devnet-entry-observation.server";

let target: string;
let env: NodeJS.ProcessEnv;
const request = (url = "http://localhost:3319/login", init = {}) =>
  new NextRequest(url, { headers: { host: "localhost:3319" }, ...init });
const records = () =>
  fs
    .readFileSync(target, "utf8")
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));

beforeEach(() => {
  target = path.join(
    os.tmpdir(),
    `landed-external-devnet-entry-${randomUUID()}.jsonl`,
  );
  env = {
    NODE_ENV: "production",
    LANDED_EXTERNAL_DEVNET_SESSION: "1",
    EXTERNAL_DEVNET_PUBLIC_GATE: "1",
    LANDED_EXTERNAL_ENTRY_DIAGNOSTIC_PATH: target,
  };
});
afterEach(() => {
  fs.rmSync(target, { force: true });
  vi.restoreAllMocks();
});

describe("temporary operator request observations", () => {
  it("pairs entry and Auth continuation without claiming a final page status", async () => {
    const response = NextResponse.next();
    expect(
      await observeDevnetOperatorEntry(request(), async () => response, env),
    ).toBe(response);
    const [entry, returned] = records();
    expect(entry.phase).toBe("received");
    expect(returned).toMatchObject({
      phase: "auth_boundary_returned",
      disposition: "continue_not_final_response",
      status: 200,
      route: "login",
    });
    expect(returned.correlationId).toBe(entry.correlationId);
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });

  it.each([307, 503, 404])(
    "preserves the exact %i Auth response and all its headers",
    async (status) => {
      const response = new Response(null, {
        status,
        headers: {
          "set-cookie": "secret-cookie",
          location: "/login?next=secret",
          "cache-control": "private, no-store",
        },
      });
      expect(
        await observeDevnetOperatorEntry(request(), async () => response, env),
      ).toBe(response);
      expect(records()[1].status).toBe(status);
      expect(fs.readFileSync(target, "utf8")).not.toMatch(
        /secret|set-cookie|cache-control|location/,
      );
    },
  );

  it("records a thrown boundary without logging its error or altering it", async () => {
    const error = new Error("password-and-token-never-log");
    await expect(
      observeDevnetOperatorEntry(
        request(),
        async () => {
          throw error;
        },
        env,
      ),
    ).rejects.toBe(error);
    expect(records()[1].phase).toBe("auth_boundary_threw");
    expect(fs.readFileSync(target, "utf8")).not.toContain(error.message);
  });

  it("drops query, IDs, cookies and unrelated headers", async () => {
    await observeDevnetOperatorEntry(
      request(
        "http://localhost:3319/projects/helios/campaigns/8b3bdfe8-93fd-4529-aa63-9adbba105dcd?signature=never-log",
        {
          headers: {
            host: "localhost:3319",
            cookie: "never-log",
            authorization: "never-log",
          },
        },
      ),
      async () => NextResponse.next(),
      env,
    );
    const text = fs.readFileSync(target, "utf8");
    expect(records()[0].route).toBe("campaign_workspace");
    expect(text).not.toMatch(
      /never-log|8b3bdfe8|signature|authorization|cookie/,
    );
  });

  it.each([
    request("http://localhost:3319/measure"),
    request("http://localhost:3319/api/wallet/proofs"),
    request("http://localhost:3319/t/8b3bdfe8-93fd-4529-aa63-9adbba105dcd"),
    request("http://localhost:3319/login", { method: "POST" }),
    request("http://localhost:3319/login", {
      headers: { host: "localhost:3319", "cf-ray": "public" },
    }),
    request("http://127.0.0.1:3319/login", {
      headers: { host: "127.0.0.1:3319" },
    }),
    request("http://localhost:3319/projects/other/settings/integrations"),
  ])(
    "never observes public, participant, write or other-origin routes",
    async (req) => {
      const operation = vi.fn(async () => NextResponse.next());
      await observeDevnetOperatorEntry(req, operation, env);
      expect(operation).toHaveBeenCalledOnce();
      expect(fs.existsSync(target)).toBe(false);
    },
  );

  it.each([
    { LANDED_EXTERNAL_DEVNET_SESSION: "0" },
    { EXTERNAL_DEVNET_PUBLIC_GATE: "0" },
    { VERCEL: "1" },
    { VERCEL_ENV: "preview" },
    { LANDED_EXTERNAL_ENTRY_DIAGNOSTIC_PATH: "/tmp/unowned-diagnostic.jsonl" },
  ])(
    "remains disabled outside the exact isolated configuration",
    async (overrides) => {
      await observeDevnetOperatorEntry(
        request(),
        async () => NextResponse.next(),
        { ...env, ...overrides },
      );
      expect(fs.existsSync(target)).toBe(false);
    },
  );

  it("does not follow symlinks or change an existing file's permissions", async () => {
    const other = target + ".other";
    try {
      fs.writeFileSync(other, "do not alter", { mode: 0o600 });
      fs.symlinkSync(other, target);
      await observeDevnetOperatorEntry(
        request(),
        async () => NextResponse.next(),
        env,
      );
      expect(fs.readFileSync(other, "utf8")).toBe("do not alter");
      fs.unlinkSync(target);
      fs.writeFileSync(target, "do not alter", { mode: 0o644 });
      await observeDevnetOperatorEntry(
        request(),
        async () => NextResponse.next(),
        env,
      );
      expect(fs.readFileSync(target, "utf8")).toBe("do not alter");
      expect(fs.statSync(target).mode & 0o777).toBe(0o644);
    } finally {
      fs.rmSync(other, { force: true });
    }
  });

  it("limits retained bytes and preserves Auth when the diagnostic writer fails", async () => {
    fs.writeFileSync(target, "x".repeat(128 * 1024), { mode: 0o600 });
    const response = NextResponse.next();
    expect(
      await observeDevnetOperatorEntry(request(), async () => response, env),
    ).toBe(response);
    expect(fs.statSync(target).size).toBe(128 * 1024);
    vi.spyOn(fs, "openSync").mockImplementation(() => {
      throw new Error("disk failure");
    });
    expect(
      await observeDevnetOperatorEntry(request(), async () => response, env),
    ).toBe(response);
  });

  it("opens non-blocking and rejects a non-regular target before writing", async () => {
    const originalOpen = fs.openSync;
    const opens = vi.spyOn(fs, "openSync").mockImplementation(originalOpen);
    const response = NextResponse.next();
    await observeDevnetOperatorEntry(request(), async () => response, env);
    for (const [, flags] of opens.mock.calls) {
      expect(Number(flags) & fs.constants.O_NONBLOCK).toBe(
        fs.constants.O_NONBLOCK,
      );
      expect(Number(flags) & fs.constants.O_NOFOLLOW).toBe(
        fs.constants.O_NOFOLLOW,
      );
    }
    const originalStat = fs.fstatSync;
    vi.spyOn(fs, "fstatSync").mockImplementation((descriptor) => {
      const stat = originalStat(descriptor);
      stat.isFile = () => false;
      return stat;
    });
    const writes = vi.spyOn(fs, "writeSync");
    expect(
      await observeDevnetOperatorEntry(request(), async () => response, env),
    ).toBe(response);
    expect(writes).not.toHaveBeenCalled();
  });
});

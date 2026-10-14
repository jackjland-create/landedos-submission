import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boundedSupabaseCookieOptions,
  supabaseCookieOptions,
} from "./cookie-options";

describe("Supabase cookie namespace", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps the default namespace when no override is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME", "");
    expect(supabaseCookieOptions()).toBeUndefined();
  });

  it("accepts one explicit preview-scoped namespace", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_LANDED_REHEARSAL_COOKIE_DEADLINE_MS",
      String(Date.now() + 300_000),
    );
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME",
      "landed-external-72c045eb",
    );
    expect(supabaseCookieOptions()).toEqual({
      name: "landed-external-72c045eb",
    });
  });

  it.each([
    "contains spaces",
    "contains.dots",
    "contains/slash",
    "x".repeat(81),
  ])("rejects an unsafe cookie namespace: %s", (name) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME", name);
    expect(() => supabaseCookieOptions()).toThrow(
      "Supabase auth cookie name is invalid.",
    );
  });
});

describe("fixed rehearsal cookie deadline", () => {
  const namespace = "landed-external-synthetic-run";
  const now = Date.parse("2026-10-06T12:00:00Z");
  const deadline = now + 300_000;
  function configure() {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME", namespace);
    vi.stubEnv(
      "NEXT_PUBLIC_LANDED_REHEARSAL_COOKIE_DEADLINE_MS",
      String(deadline),
    );
  }
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it.each([
    "",
    ".0",
    ".12",
    "-code-verifier",
    "-code-verifier.0",
    "-flows-code-verifier.1",
    "-flow-abcdefgh-code-verifier.0",
  ])("bounds owned SDK suffix %s after its 400-day override", (suffix) => {
    configure();
    const result = boundedSupabaseCookieOptions(namespace + suffix, {
      maxAge: 34_560_000,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
    expect(result).toEqual({
      maxAge: 300,
      expires: new Date(deadline),
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  });

  it("never slides the deadline on refresh and expires later writes", () => {
    configure();
    vi.setSystemTime(now + 120_000);
    expect(
      boundedSupabaseCookieOptions(namespace, { maxAge: 34_560_000 }),
    ).toEqual({ maxAge: 180, expires: new Date(deadline) });
    vi.setSystemTime(deadline + 1);
    expect(
      boundedSupabaseCookieOptions(namespace, { maxAge: 34_560_000 }),
    ).toEqual({ maxAge: 0, expires: new Date(0) });
  });

  it.each([
    "landed-external-other-run",
    "sb-production-auth-token",
    namespace + "-other",
    namespace + ".foo",
    namespace + "-flow-short-code-verifier",
  ])("leaves foreign/unrelated cookie %s untouched", (name) => {
    configure();
    const options = { maxAge: 34_560_000, path: "/" };
    expect(boundedSupabaseCookieOptions(name, options)).toBe(options);
  });

  it("preserves SDK chunk-removal options and shorter limits", () => {
    configure();
    const removal = { maxAge: 0, expires: new Date(0), path: "/" };
    expect(boundedSupabaseCookieOptions(namespace + ".0", removal)).toBe(
      removal,
    );
    expect(boundedSupabaseCookieOptions(namespace, { maxAge: 60 }).maxAge).toBe(
      60,
    );
    expect(
      boundedSupabaseCookieOptions(namespace, {
        expires: new Date(now + 30_000),
      }).maxAge,
    ).toBe(30);
  });

  it.each([
    "",
    "NaN",
    "1.5",
    "-1",
    String(now + 3_600_001),
    "9007199254740992",
  ])("rejects missing or invalid rehearsal deadline %s", (value) => {
    configure();
    vi.stubEnv("NEXT_PUBLIC_LANDED_REHEARSAL_COOKIE_DEADLINE_MS", value);
    expect(() => supabaseCookieOptions()).toThrow(
      "Rehearsal cookie deadline is invalid.",
    );
  });

  it.each(["", "landed-production"])(
    "does not require a deadline or alter production namespace %s",
    (name) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME", name);
      vi.stubEnv("NEXT_PUBLIC_LANDED_REHEARSAL_COOKIE_DEADLINE_MS", "");
      const options = { maxAge: 34_560_000 };
      expect(
        boundedSupabaseCookieOptions(name || "sb-default-auth-token", options),
      ).toBe(options);
    },
  );
});

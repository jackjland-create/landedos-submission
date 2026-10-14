// INT-01 / FND-08 / SEC-02: real installed SDK writes, synthetic memory only.
import { createBrowserClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  writes: [] as { name: string; value: string; options: CookieOptions }[],
  proxySession: null as null | { access_token: string; refresh_token: string },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...state.jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options: CookieOptions) => {
      state.writes.push({ name, value, options });
      if (options.maxAge === 0) state.jar.delete(name);
      else state.jar.set(name, value);
    },
  }),
}));
vi.mock("@supabase/ssr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/ssr")>();
  return {
    ...actual,
    createServerClient: (
      ...args: Parameters<typeof actual.createServerClient>
    ) => {
      const client = actual.createServerClient(...args);
      // Only claims retrieval is replaced. Session persistence/setAll is real SDK.
      if (state.proxySession)
        client.auth.getClaims = vi.fn(async () => {
          const result = await client.auth.setSession(state.proxySession!);
          if (result.error) throw result.error;
          return {
            data: { claims: { sub: "synthetic-user" } },
            error: null,
          } as Awaited<ReturnType<typeof client.auth.getClaims>>;
        });
      return client;
    },
  };
});

import { rehearsalBrowserCookies } from "./client";
import { supabaseCookieOptions } from "./cookie-options";
import { createClient as serverClient } from "./server";
import { updateSession } from "./proxy";

const now = Date.parse("2026-10-06T12:00:00Z");
const deadline = now + 300_000;
// The real SDK broadcasts by storage key. Give each test its own run namespace
// so retained SDK instances cannot deliver another test's auth/cookie events.
let namespace = "landed-external-synthetic-run";
let testRun = 0;
const sdkMaxAge = 34_560_000;
function session(padding = "") {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "synthetic-user", exp: Math.floor(now / 1000) + 3600, padding })}.synthetic-signature`,
    refresh_token: "synthetic-refresh-token",
  };
}
function configure(name = namespace) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME", name);
  vi.stubEnv(
    "NEXT_PUBLIC_LANDED_REHEARSAL_COOKIE_DEADLINE_MS",
    String(deadline),
  );
}
function assertBounded(writes: typeof state.writes, maxAge = 300) {
  const active = writes.filter(({ options }) => options.maxAge !== 0);
  expect(active.length).toBeGreaterThan(0);
  for (const { name, options } of active) {
    expect(name.startsWith(namespace)).toBe(true);
    expect(options.maxAge).toBe(maxAge);
    expect(options.expires).toEqual(new Date(deadline));
  }
}

describe("actual SDK cookie persistence boundaries", () => {
  beforeEach(() => {
    namespace = `landed-external-synthetic-run-${++testRun}`;
    state.jar.clear();
    state.writes.length = 0;
    state.proxySession = null;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-key");
    configure();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        // Strictly synthetic; any unexpected request fails without network access.
        if (
          String(input) ===
          "https://synthetic.supabase.test/auth/v1/logout?scope=local"
        )
          return new Response(null, { status: 204 });
        expect(String(input)).toBe(
          "https://synthetic.supabase.test/auth/v1/user",
        );
        return new Response(
          JSON.stringify({
            id: "synthetic-user",
            aud: "authenticated",
            role: "authenticated",
            email: "synthetic@example.test",
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-10-06T12:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    state.proxySession = null;
  });

  it("browser actual setSession writes cap SDK options; chunks shrink with zero-age removals", async () => {
    const serialized: string[] = [];
    vi.spyOn(document, "cookie", "get").mockImplementation(() =>
      [...state.jar].map(([key, value]) => `${key}=${value}`).join("; "),
    );
    vi.spyOn(document, "cookie", "set").mockImplementation((value) => {
      serialized.push(value);
      const pair = value.split(";")[0];
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      if (value.includes("Max-Age=0")) state.jar.delete(name);
      else state.jar.set(name, pair.slice(index + 1));
    });
    const client = createBrowserClient(
      "https://synthetic.supabase.test",
      "synthetic-key",
      {
        isSingleton: false,
        cookieOptions: supabaseCookieOptions(),
        cookies: rehearsalBrowserCookies(),
        auth: { autoRefreshToken: false, detectSessionInUrl: false },
      },
    );
    try {
      expect(
        (await client.auth.setSession(session("x".repeat(8000)))).error,
      ).toBeNull();
      expect(state.jar.size).toBeGreaterThan(1);
      expect(
        serialized.every(
          (value) =>
            value.includes("Max-Age=300") &&
            value.includes(`Expires=${new Date(deadline).toUTCString()}`),
        ),
      ).toBe(true);
      serialized.length = 0;
      vi.setSystemTime(now + 120_000);
      expect((await client.auth.setSession(session())).error).toBeNull();
      expect(serialized.some((value) => value.includes("Max-Age=0"))).toBe(
        true,
      );
      expect(
        serialized
          .filter((value) => !value.includes("Max-Age=0"))
          .every(
            (value) =>
              value.includes("Max-Age=180") &&
              value.includes(`Expires=${new Date(deadline).toUTCString()}`),
          ),
      ).toBe(true);
      expect(state.jar.size).toBe(1);
    } finally {
      client.auth.stopAutoRefresh();
    }
  });

  it("server actual setSession clamps chunks and later writes without renewing the deadline", async () => {
    const client = await serverClient();
    expect(
      (await client.auth.setSession(session("x".repeat(8000)))).error,
    ).toBeNull();
    expect(state.writes.length).toBeGreaterThan(1);
    assertBounded(state.writes);
    state.writes.length = 0;
    vi.setSystemTime(now + 120_000);
    expect((await client.auth.setSession(session())).error).toBeNull();
    expect(state.writes.some(({ options }) => options.maxAge === 0)).toBe(true);
    assertBounded(state.writes, 180);
    state.writes.length = 0;
    vi.setSystemTime(deadline + 1);
    expect((await client.auth.setSession(session())).error).toBeNull();
    expect(state.writes.length).toBeGreaterThan(0);
    expect(state.writes.every(({ options }) => options.maxAge === 0)).toBe(
      true,
    );
  });

  it("proxy actual SDK writes produce bounded response cookies and preserve no-cache headers", async () => {
    state.proxySession = session("x".repeat(8000));
    const response = await updateSession(
      new NextRequest("https://application.test/projects/helios/overview"),
    );
    expect(response.status).toBe(200);
    assertBounded(
      response.cookies.getAll().map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        options: {
          ...cookie,
          expires:
            cookie.expires === undefined ? undefined : new Date(cookie.expires),
        },
      })),
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("ordinary production server writes retain the installed SDK's 400-day default", async () => {
    configure("landed-production");
    const client = await serverClient();
    expect((await client.auth.setSession(session())).error).toBeNull();
    expect(state.writes.length).toBeGreaterThan(0);
    expect(
      state.writes.every(
        ({ options }) =>
          options.maxAge === sdkMaxAge && options.expires === undefined,
      ),
    ).toBe(true);
    expect(rehearsalBrowserCookies()).toBeUndefined();
  });

  it("actual SDK PKCE writes have the same fixed expiry", async () => {
    const client = await serverClient();
    const result = await client.auth.signInWithOAuth({
      provider: "github",
      options: { skipBrowserRedirect: true },
    });
    expect(result.error).toBeNull();
    expect(state.writes.length).toBeGreaterThan(0);
    expect(
      state.writes.every(({ name }) => name.endsWith("-code-verifier")),
    ).toBe(true);
    assertBounded(state.writes);
  });

  it("a second run never removes or renews a previous run's cookies, including on sign-out", async () => {
    const previous = "landed-external-previous-run";
    state.jar.set(previous, "synthetic-old-cookie");
    state.jar.set("sb-production-auth-token", "synthetic-production-cookie");
    const client = await serverClient();
    expect((await client.auth.setSession(session())).error).toBeNull();
    expect((await client.auth.signOut({ scope: "local" })).error).toBeNull();
    expect(state.writes.some(({ options }) => options.maxAge === 0)).toBe(true);
    expect(state.writes.every(({ name }) => name.startsWith(namespace))).toBe(
      true,
    );
    expect(state.jar.get(previous)).toBe("synthetic-old-cookie");
    expect(state.jar.get("sb-production-auth-token")).toBe(
      "synthetic-production-cookie",
    );
  });
});

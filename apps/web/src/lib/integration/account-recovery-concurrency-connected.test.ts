// @vitest-environment node
// FND-04: exact isolated Auth reuse, not a hosted-provider or browser test.
import { createHash, randomBytes } from "node:crypto";
import { beforeAll, describe, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  createAccount,
  recoverPassword,
  requestRecoveryCode,
} from "@/app/login/account-actions";

const origin = "http://127.0.0.1:57521";
const enabled =
  process.env.LANDED_ISOLATED_AUTH_TEST === "landed-dem01-isolated-20261008" &&
  process.env.LANDED_ISOLATED_AUTH_CONCURRENCY === "serializable";
const idle = { status: "idle" as const };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function requireCheck(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label); // Never interpolate credentials/provider bodies.
}
function values(input: Record<string, string>) {
  const form = new FormData();
  Object.entries(input).forEach(([key, value]) => form.set(key, value));
  return form;
}
function client() {
  return createClient(
    origin,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}
const consumedMail = new Set<string>();
async function captured(email: string) {
  for (let i = 0; i < 30; i++) {
    const list = await (
      await fetch("http://127.0.0.1:57524/api/v1/messages")
    ).json();
    const item = list.messages.find(
      (entry: { ID: string; To: { Address: string }[] }) =>
        !consumedMail.has(entry.ID) &&
        entry.To.some((to) => to.Address === email),
    );
    if (item) {
      consumedMail.add(item.ID);
      return String(
        (
          await (
            await fetch(`http://127.0.0.1:57524/api/v1/message/${item.ID}`)
          ).json()
        ).HTML,
      );
    }
    await pause(100);
  }
  throw new Error("Expected isolated captured mail missing");
}
async function codeFor(email: string) {
  await pause(1100);
  requireCheck(
    (await requestRecoveryCode(idle, values({ email }))).status === "sent",
    "Fresh recovery request must be accepted",
  );
  const html = await captured(email);
  requireCheck(
    !html.includes("href="),
    "Recovery mail must not contain a consuming link",
  );
  const code = html.match(/Recovery code:\s*(\d{6})/)?.[1];
  requireCheck(code, "Expected recovery code absent");
  return code;
}
type Method = "email" | "hash" | "get";
async function verify(method: Method, email: string, token: string) {
  // Match pinned GoTrue v2.188.1 GenerateTokenHash (SHA-224, not SHA-256).
  const tokenHash = createHash("sha224")
    .update(email + token)
    .digest("hex");
  if (method === "get") {
    const response = await fetch(
      `${origin}/auth/v1/verify?token=${tokenHash}&type=recovery`,
      { redirect: "manual" },
    );
    const location = response.headers.get("location");
    const fragment = new URLSearchParams(
      location ? new URL(location).hash.slice(1) : "",
    );
    return {
      success: fragment.has("access_token") || fragment.has("refresh_token"),
      status: response.status,
    };
  }
  const result = await client().auth.verifyOtp(
    method === "email"
      ? { email, token, type: "recovery" }
      : { token_hash: tokenHash, type: "recovery" },
  );
  // Count any returned session as success, even if an error is also present.
  return {
    success: Boolean(result.data.session),
    status: result.error?.status ?? 200,
  };
}

describe.skipIf(!enabled)("isolated recovery concurrency mitigation", () => {
  beforeAll(() => {
    requireCheck(
      process.env.NEXT_PUBLIC_SUPABASE_URL === origin &&
        process.env.NEXT_PUBLIC_APP_URL === origin,
      "All mutations require exact isolated Auth and app origins",
    );
  });
  it("admits one session across competing endpoint shapes and one password change", async () => {
    const email = `race-${randomBytes(8).toString("hex")}@isolated.test`;
    const originalPassword = randomBytes(24).toString("base64url");
    requireCheck(
      (
        await createAccount(
          idle,
          values({
            email,
            password: originalPassword,
            fullName: "Disposable concurrency test",
            accountType: "brand",
          }),
        )
      ).status === "sent",
      "Disposable signup smoke check",
    );
    const link = (await captured(email))
      .match(/href="([^"]+)"/)?.[1]
      ?.replaceAll("&amp;", "&");
    requireCheck(link, "Local confirmation link required");
    const url = new URL(link);
    requireCheck(
      url.origin === origin && url.pathname === "/auth/confirm",
      "Local-only confirmation target",
    );
    const tokenHash = url.searchParams.get("token_hash");
    requireCheck(tokenHash, "Confirmation hash required");
    requireCheck(
      !(
        await client().auth.verifyOtp({ token_hash: tokenHash, type: "signup" })
      ).error,
      "Signup confirmation smoke check",
    );
    requireCheck(
      !(
        await client().auth.signInWithPassword({
          email,
          password: originalPassword,
        })
      ).error,
      "Fresh sign-in smoke check",
    );

    const rounds: Method[][] = [
      ["email", "email", "email", "email"],
      ["hash", "hash", "hash", "hash"],
      ["get", "get", "get", "get"],
      ["get", "email", "hash", "email"],
    ];
    for (let round = 0; round < rounds.length; round++) {
      const code = await codeFor(email);
      const results = await Promise.all(
        rounds[round].map((method) => verify(method, email, code)),
      );
      const successes = results.filter((result) => result.success).length;
      console.log(
        `CHECK: race round ${round + 1}, sessions=${successes}, responses=${results.map((result) => result.status).join(",")}`,
      );
      requireCheck(
        results.every((result) => result.status !== 429),
        "Rate limiting cannot masquerade as single-use enforcement",
      );
      requireCheck(
        successes === 1,
        "One recovery code must yield exactly one session under parallel requests",
      );
    }
    console.log(
      "PASS: four four-request races; email-code POST, hash POST, GET and mixed endpoint shapes each admit one session only.",
    );

    const code = await codeFor(email);
    const passwords = [
      randomBytes(24).toString("base64url"),
      randomBytes(24).toString("base64url"),
    ];
    const results = await Promise.all(
      passwords.map((password) =>
        recoverPassword(idle, values({ email, code, password })),
      ),
    );
    const winner = results.findIndex((result) => result.status === "complete");
    requireCheck(
      winner >= 0 &&
        results.filter((result) => result.status === "complete").length === 1 &&
        results.filter((result) => result.status === "restart").length === 1,
      "Concurrent actions require exactly one completion and one restart",
    );
    requireCheck(
      !(
        await client().auth.signInWithPassword({
          email,
          password: passwords[winner],
        })
      ).error,
      "Winning password must sign in",
    );
    requireCheck(
      Boolean(
        (
          await client().auth.signInWithPassword({
            email,
            password: passwords[1 - winner],
          })
        ).error,
      ),
      "Losing password must never take effect",
    );
    requireCheck(
      Boolean(
        (
          await client().auth.signInWithPassword({
            email,
            password: originalPassword,
          })
        ).error,
      ),
      "Original password must be replaced",
    );
    requireCheck(
      (
        await recoverPassword(
          idle,
          values({ email, code, password: originalPassword }),
        )
      ).status === "restart",
      "Losing request cannot reuse consumed code later",
    );
    const fresh = await codeFor(email);
    requireCheck(
      (
        await recoverPassword(
          idle,
          values({ email, code: fresh, password: originalPassword }),
        )
      ).status === "complete",
      "Fresh recovery remains possible after a collision",
    );
    console.log(
      "PASS: two competing password actions produce one winner; only its password works; consumed code rejects and fresh-code recovery works.",
    );

    requireCheck(
      (
        await requestRecoveryCode(
          idle,
          values({ email: "absent-race-test@isolated.test" }),
        )
      ).status === "sent",
      "Unknown-account response remains generic",
    );
    let limited = false;
    for (let i = 0; i < 40; i++) {
      const result = await client().auth.verifyOtp({
        email,
        token: "000000",
        type: "recovery",
      });
      if (result.error?.status === 429) {
        limited = true;
        break;
      }
    }
    requireCheck(
      limited,
      "Provider verification rate limit must eventually reject",
    );
    console.log(
      "PASS: generic unknown-account response and verification rate limit; shared infrastructure IP, not per-user abuse acceptance.",
    );
  }, 45000);
});

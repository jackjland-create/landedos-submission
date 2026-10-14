// @vitest-environment node
// FND-04: invoked only by check-isolated-account-auth.cjs, never hosted Auth.
import { randomBytes } from "node:crypto";
import { beforeAll, describe, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  createAccount,
  requestRecoveryCode,
  recoverPassword,
} from "@/app/login/account-actions";

const enabled =
  process.env.LANDED_ISOLATED_AUTH_TEST === "landed-dem01-isolated-20261008";
const idle = { status: "idle" as const, message: "" };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function check(value: unknown, label: string): asserts value {
  // Boolean-only errors deliberately avoid printing credentials/codes/sessions.
  if (!value) throw new Error(label);
}
function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [name, value] of Object.entries(values)) result.set(name, value);
  return result;
}
function client() {
  check(
    process.env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:57521",
    "Non-isolated Auth origin refused",
  );
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
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
const seen = new Set<string>();
async function mail(email: string) {
  for (let i = 0; i < 30; i++) {
    const list = await (
      await fetch("http://127.0.0.1:57524/api/v1/messages")
    ).json();
    const item = list.messages.find(
      (entry: { ID: string; To: { Address: string }[] }) =>
        !seen.has(entry.ID) && entry.To.some((to) => to.Address === email),
    );
    if (item) {
      seen.add(item.ID);
      const data = await (
        await fetch(`http://127.0.0.1:57524/api/v1/message/${item.ID}`)
      ).json();
      return String(data.HTML);
    }
    await wait(100);
  }
  throw new Error("Expected captured email not received");
}
async function recoveryCode(email: string) {
  await wait(1100);
  check(
    (await requestRecoveryCode(idle, form({ email }))).status === "sent",
    "Recovery request accepted",
  );
  const html = await mail(email);
  check(
    !html.includes("href="),
    "Recovery template must not consume codes through a link",
  );
  const code = html.match(/Recovery code:\s*(\d{6})/)?.[1];
  check(code, "Recovery email must contain a six-digit code");
  return code;
}

describe.skipIf(!enabled)("isolated real Auth account actions", () => {
  beforeAll(() => {
    check(
      process.env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:57521" &&
        process.env.NEXT_PUBLIC_APP_URL === "http://127.0.0.1:57521",
      "Refuse all actions unless both origins are the exact isolated runtime",
    );
  });
  it("confirms two independent identities, signs back in and enforces recovery evidence", async () => {
    const a = `brand-${randomBytes(5).toString("hex")}@isolated.test`;
    const b = `agency-${randomBytes(5).toString("hex")}@isolated.test`;
    const password = randomBytes(24).toString("base64url");
    const updated = randomBytes(24).toString("base64url");
    const ids: string[] = [];
    for (const [email, accountType] of [
      [a, "brand"],
      [b, "agency"],
    ]) {
      check(
        (
          await createAccount(
            idle,
            form({
              email,
              password,
              fullName: "Disposable test account",
              accountType,
            }),
          )
        ).status === "sent",
        "Signup action must accept valid account",
      );
      check(
        Boolean(
          (await client().auth.signInWithPassword({ email, password })).error,
        ),
        "Unconfirmed identity must not sign in",
      );
      const html = await mail(email);
      const href = html.match(/href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
      check(href, "Confirmation email must contain a link");
      const url = new URL(href);
      check(
        url.origin === "http://127.0.0.1:57521" &&
          url.pathname === "/auth/confirm" &&
          url.searchParams.get("type") === "signup",
        "Confirmation link must target exact approved local callback",
      );
      const tokenHash = url.searchParams.get("token_hash");
      check(tokenHash, "Confirmation hash present");
      const confirmed = await client().auth.verifyOtp({
        token_hash: tokenHash,
        type: "signup",
      });
      check(
        !confirmed.error && confirmed.data.user,
        "Email confirmation must succeed",
      );
      check(
        Boolean(
          (
            await client().auth.verifyOtp({
              token_hash: tokenHash,
              type: "signup",
            })
          ).error,
        ),
        "Confirmation link must reject reuse",
      );
      const session = await client().auth.signInWithPassword({
        email,
        password,
      });
      check(
        !session.error && session.data.user,
        "Confirmed account must sign back in",
      );
      check(
        session.data.user.user_metadata.account_type === accountType,
        "Selected profile type must persist",
      );
      ids.push(session.data.user.id);
    }
    check(ids[0] !== ids[1], "Two accounts must have distinct identity IDs");
    console.log(
      "PASS: two confirmed identities, persisted profiles, unconfirmed/reused confirmation rejected, fresh sign-in.",
    );

    const code = await recoveryCode(a);
    check(
      (await recoverPassword(idle, form({ email: b, code, password: updated })))
        .status === "restart",
      "Recovery code must not work for another identity",
    );
    check(
      Boolean(
        (
          await client().auth.verifyOtp({
            email: a,
            token: code,
            type: "signup",
          })
        ).error,
      ),
      "Recovery code must reject wrong verification type",
    );
    const wrongCode = code === "000000" ? "999999" : "000000";
    check(
      (
        await recoverPassword(
          idle,
          form({ email: a, code: wrongCode, password: updated }),
        )
      ).status === "restart",
      "Invalid recovery code must fail",
    );
    check(
      (await recoverPassword(idle, form({ email: a, code, password: updated })))
        .status === "complete",
      "Correct recovery evidence must change password",
    );
    check(
      (await recoverPassword(idle, form({ email: a, code, password })))
        .status === "restart",
      "Used recovery code must fail",
    );
    check(
      Boolean(
        (await client().auth.signInWithPassword({ email: a, password })).error,
      ),
      "Old password must fail after confirmed update",
    );
    check(
      !(await client().auth.signInWithPassword({ email: a, password: updated }))
        .error,
      "New password must sign in",
    );
    check(
      !(await client().auth.signInWithPassword({ email: b, password })).error,
      "Other identity must remain unchanged",
    );
    console.log(
      "PASS: recovery, wrong identity/type/code and reuse rejected; old/new passwords and untouched second user verified.",
    );

    const expired = await recoveryCode(b);
    await wait(21000);
    check(
      (
        await recoverPassword(
          idle,
          form({ email: b, code: expired, password: updated }),
        )
      ).status === "restart",
      "Expired code must fail",
    );
    const otp = await recoveryCode(b);
    const verifications = await Promise.all([
      client().auth.verifyOtp({ email: b, token: otp, type: "recovery" }),
      client().auth.verifyOtp({ email: b, token: otp, type: "recovery" }),
    ]);
    check(
      verifications.filter((result) => !result.error && result.data.session)
        .length === 1 &&
        verifications.filter((result) => result.error && !result.data.session)
          .length === 1,
      "Concurrent OTP verification must return exactly one authenticated session",
    );
    const concurrent = await recoveryCode(b);
    const outcomes = await Promise.all([
      recoverPassword(
        idle,
        form({
          email: b,
          code: concurrent,
          password: randomBytes(24).toString("base64url"),
        }),
      ),
      recoverPassword(
        idle,
        form({ email: b, code: concurrent, password: updated }),
      ),
    ]);
    check(
      outcomes.filter((result) => result.status === "complete").length === 1,
      "Concurrent code use must have exactly one successful password action",
    );
    check(
      outcomes.filter((result) => result.status === "restart").length === 1,
      "Concurrent loser must require fresh recovery",
    );
    console.log(
      "PASS: expired recovery rejected; concurrent use has one success and one fresh-code restart.",
    );

    check(
      (await requestRecoveryCode(idle, form({ email: "absent@isolated.test" })))
        .status === "sent",
      "Unknown account response must be generic",
    );
    let rateLimited = false;
    for (let i = 0; i < 40; i++) {
      const result = await client().auth.verifyOtp({
        email: a,
        token: wrongCode,
        type: "recovery",
      });
      if (result.error?.status === 429) {
        rateLimited = true;
        break;
      }
    }
    check(rateLimited, "Provider must enforce verification rate limit");
    console.log(
      "PASS: generic unknown-account response and provider verification rate limit. Shared infrastructure-IP scope only.",
    );
  }, 90000);
});

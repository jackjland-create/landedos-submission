import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAccount,
  recoverPassword,
  requestRecoveryCode,
} from "./account-actions";
import { accountFlowCopy as copy } from "@/lib/auth/account-flow";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  signUp: vi.fn(),
  reset: vi.fn(),
  verify: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.create }));
const idle = { status: "idle" as const };
const user = { id: "synthetic-user", email: "synthetic@example.test" };
function form(overrides: Record<string, string | undefined> = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({
    email: user.email,
    password: "synthetic-password",
    code: "123456",
    fullName: "Synthetic User",
    accountType: "agency",
    ...overrides,
  }))
    if (value !== undefined) result.set(key, value);
  return result;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("LANDED_ACCOUNT_FLOWS_ENABLED", "1");
  vi.stubEnv("LANDED_PASSWORD_RECOVERY_ENABLED", "1");
  vi.stubEnv("LANDED_LOCAL_DEVNET_INPUT_LOCK", "");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-public-key");
  mocks.create.mockImplementation(() => ({
    auth: {
      signUp: mocks.signUp,
      resetPasswordForEmail: mocks.reset,
      verifyOtp: mocks.verify,
      updateUser: mocks.update,
    },
  }));
  mocks.signUp.mockResolvedValue({ error: null });
  mocks.reset.mockResolvedValue({ error: null });
  mocks.verify.mockResolvedValue({
    error: null,
    data: { user, session: { user, access_token: "never-return-token" } },
  });
  mocks.update.mockResolvedValue({ error: null, data: { user } });
});
afterEach(() => vi.unstubAllEnvs());

describe("gated account flows", () => {
  it.each(["", "true", "0"])(
    "denies all new actions before provider acquisition when flag is %s",
    async (flag) => {
      vi.stubEnv("LANDED_ACCOUNT_FLOWS_ENABLED", flag);
      for (const action of [
        createAccount,
        requestRecoveryCode,
        recoverPassword,
      ])
        expect(await action(idle, form())).toEqual({
          status: "error",
          message: copy.disabled,
        });
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it.each(["review", "drain", "unknown"])(
    "preserves closed-input mode %s before all provider calls",
    async (mode) => {
      vi.stubEnv("LANDED_LOCAL_DEVNET_INPUT_LOCK", mode);
      for (const action of [
        createAccount,
        requestRecoveryCode,
        recoverPassword,
      ])
        expect((await action(idle, form())).status).toBe("error");
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it("requires the separate recovery flag", async () => {
    vi.stubEnv("LANDED_PASSWORD_RECOVERY_ENABLED", "");
    await requestRecoveryCode(idle, form());
    await recoverPassword(idle, form());
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("saves only allowed profile metadata, without granting membership", async () => {
    expect(
      (
        await createAccount(
          idle,
          form({
            role: "admin",
            workspaceId: "forged",
            fullName: " Synthetic User ",
          }),
        )
      ).status,
    ).toBe("sent");
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: user.email,
      password: "synthetic-password",
      options: {
        emailRedirectTo: "https://app.example.test/auth/confirm",
        data: { full_name: "Synthetic User", account_type: "agency" },
      },
    });
  });
  it.each([
    { fullName: " " },
    { accountType: "admin" },
    { password: "short" },
    { email: "bad" },
  ])("rejects invalid signup fields %j before Auth", async (fields) => {
    expect((await createAccount(idle, form(fields))).status).toBe("error");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects unsafe confirmation origins", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://external.example.test");
    expect((await createAccount(idle, form())).status).toBe("error");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not claim a failed signup saved nothing", async () => {
    mocks.signUp.mockRejectedValue(new Error("private provider detail"));
    expect(await createAccount(idle, form())).toEqual({
      status: "error",
      message: copy.unavailable,
    });
  });
  it("uses identical reset responses for success and account-specific errors", async () => {
    const first = await requestRecoveryCode(idle, form());
    mocks.reset.mockResolvedValue({
      error: { status: 400, message: "not found" },
    });
    expect(await requestRecoveryCode(idle, form())).toEqual(first);
  });
  it.each([429, 500])(
    "reports unconfirmed reset request for provider status %s",
    async (status) => {
      mocks.reset.mockResolvedValue({ error: { status } });
      expect(await requestRecoveryCode(idle, form())).toEqual({
        status: "error",
        message: copy.unavailable,
      });
    },
  );
});

describe("recovery-only mutation", () => {
  it("uses a fresh non-persistent public client and verifies recovery immediately before update", async () => {
    const result = await recoverPassword(idle, form());
    expect(mocks.create).toHaveBeenCalledWith(
      "https://auth.example.test",
      "synthetic-public-key",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
    expect(mocks.verify).toHaveBeenCalledWith({
      email: user.email,
      token: "123456",
      type: "recovery",
    });
    expect(mocks.update).toHaveBeenCalledWith({
      password: "synthetic-password",
    });
    expect(mocks.verify.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.update.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({ status: "complete", message: copy.complete });
    expect(JSON.stringify(result)).not.toMatch(
      /synthetic-password|123456|never-return-token|synthetic-user/,
    );
  });
  it.each([
    { password: "short" },
    { code: "" },
    { code: "<fake>" },
    { email: "invalid" },
  ])("validates %j before code consumption", async (fields) => {
    expect((await recoverPassword(idle, form(fields))).status).toBe("error");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["expired", "reused", "wrong-type", "tampered"])(
    "denies provider-rejected %s code, even with a normal session in previous state",
    async (reason) => {
      mocks.verify.mockResolvedValue({
        error: { message: reason },
        data: { user, session: { user } },
      });
      expect(
        (
          await recoverPassword(
            { ...idle, ...{ session: { user }, authorized: true } },
            form(),
          )
        ).status,
      ).toBe("restart");
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );
  it.each([
    { user: null, session: { user } },
    { user, session: null },
    { user, session: { user: { id: "other" } } },
    { user: { ...user, email: "other@example.test" }, session: { user } },
  ])("requires a matching verified identity and session: %j", async (data) => {
    mocks.verify.mockResolvedValue({ error: null, data });
    expect((await recoverPassword(idle, form())).status).toBe("restart");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(["error", "exception", "missing-user"])(
    "requires fresh recovery after update %s, without automatic retry",
    async (outcome) => {
      if (outcome === "exception")
        mocks.update.mockRejectedValue(new Error("network"));
      else
        mocks.update.mockResolvedValue({
          error: outcome === "error" ? { message: "denied" } : null,
          data: { user: null },
        });
      expect(await recoverPassword(idle, form())).toEqual({
        status: "restart",
        message: copy.updateUnknown,
      });
      expect(mocks.update).toHaveBeenCalledTimes(1);
    },
  );
  it("isolates parallel requests and does not update when provider rejects replay", async () => {
    mocks.verify
      .mockResolvedValueOnce({ error: null, data: { user, session: { user } } })
      .mockResolvedValueOnce({
        error: { message: "consumed" },
        data: { user: null, session: null },
      });
    const results = await Promise.all([
      recoverPassword(idle, form()),
      recoverPassword(idle, form()),
    ]);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.status)).toEqual([
      "complete",
      "restart",
    ]);
  });
});

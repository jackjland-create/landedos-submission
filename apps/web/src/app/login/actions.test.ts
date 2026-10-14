import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
  signInWithPassword: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { login, signup } from "./actions";

afterEach(() => vi.unstubAllEnvs());

function credentials(next: string) {
  const form = new FormData();
  form.set("email", "manager@landed.test");
  form.set("password", "long-enough-password");
  form.set("next", next);
  return form;
}

describe("login return", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({
      auth: { signInWithPassword: mocks.signInWithPassword },
    });
    mocks.signInWithPassword.mockResolvedValue({ error: null });
  });

  it("returns a signed-in operator to the exact protected basket view", async () => {
    const next =
      "/projects/helios/baskets/b27f30d0-ad32-4049-b7f7-388024dbe474?view=approval";

    await expect(login(credentials(next))).rejects.toThrow(`REDIRECT:${next}`);
    expect(mocks.redirect).toHaveBeenCalledWith(next);
  });

  it("retains the safe destination when credentials fail", async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: new Error("denied") });
    const next = "/projects/helios/baskets/example?view=plan";

    await expect(login(credentials(next))).rejects.toThrow("REDIRECT:/login?");
    const target = new URL(
      String(mocks.redirect.mock.calls[0]?.[0]),
      "https://landed.invalid",
    );
    expect(target.searchParams.get("next")).toBe(next);
    expect(target.searchParams.get("error")).toBe(
      "The credentials could not be verified",
    );
  });

  it("does not redirect to an external origin", async () => {
    await expect(
      login(credentials("https://attacker.example/projects/helios/overview")),
    ).rejects.toThrow("REDIRECT:/projects/helios/overview");
    expect(mocks.redirect).toHaveBeenCalledWith("/projects/helios/overview");
  });

  it("reauthenticates the same exact review route without changing campaign authority", async () => {
    vi.stubEnv("LANDED_LOCAL_DEVNET_INPUT_LOCK", "review");
    const next =
      "/projects/helios/campaigns/00000000-0000-4000-8000-000000000001?view=results&executionJob=00000000-0000-4000-8000-000000000002";
    await expect(login(credentials(next))).rejects.toThrow(`REDIRECT:${next}`);
    expect(mocks.signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it("denies signup in the read-only submission before acquiring Auth", async () => {
    vi.stubEnv("LANDED_SUBMISSION_SNAPSHOT", "1");
    await expect(signup(credentials("/login"))).rejects.toThrow("Account+creation+is+unavailable+in+closed+review");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each(["drain", "review", "unknown"])(
    "denies signup in %s before acquiring Auth",
    async (mode) => {
      vi.stubEnv("LANDED_LOCAL_DEVNET_INPUT_LOCK", mode);
      await expect(signup(credentials("/login"))).rejects.toThrow(
        "Account+creation+is+unavailable+in+closed+review",
      );
      expect(mocks.createClient).not.toHaveBeenCalled();
    },
  );
});

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createClientMock,
  getClaimsMock,
  logErrorMock,
  revalidatePathMock,
  signOutMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  getClaimsMock: vi.fn(),
  logErrorMock: vi.fn(() => "corr_signout_test"),
  revalidatePathMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/observability", () => ({
  logError: logErrorMock,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

import { POST } from "./route";

function signoutRequest() {
  return new NextRequest("https://landed-kol-os.vercel.app/auth/signout", {
    method: "POST",
  });
}

describe("preview sign out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({
      auth: {
        getClaims: getClaimsMock,
        signOut: signOutMock,
      },
    });
  });

  it("terminates only the current session and redirects to login", async () => {
    getClaimsMock.mockResolvedValue({
      data: { claims: { sub: "preview-user" } },
    });
    signOutMock.mockResolvedValue({ error: null });

    const response = await POST(signoutRequest());

    expect(signOutMock).toHaveBeenCalledWith({ scope: "local" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://landed-kol-os.vercel.app/login?message=Preview+session+closed",
    );
  });

  it("does not call sign out when no authenticated session exists", async () => {
    getClaimsMock.mockResolvedValue({ data: { claims: null } });

    const response = await POST(signoutRequest());

    expect(signOutMock).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
  });

  it("reports a failed sign out without claiming success", async () => {
    const error = new Error("sign out unavailable");
    getClaimsMock.mockResolvedValue({
      data: { claims: { sub: "preview-user" } },
    });
    signOutMock.mockResolvedValue({ error });

    const response = await POST(signoutRequest());

    expect(logErrorMock).toHaveBeenCalledWith({
      event: "auth_signout_failed",
      error,
      projectId: "helios",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://landed-kol-os.vercel.app/login?error=The+preview+session+could+not+be+closed&reference=corr_signout_test",
    );
  });
});

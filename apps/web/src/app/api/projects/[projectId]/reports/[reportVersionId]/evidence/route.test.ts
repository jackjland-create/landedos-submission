import { beforeEach, describe, expect, it, vi } from "vitest";

const { evidenceMock, fromMock, logErrorMock } = vi.hoisted(() => ({
  evidenceMock: vi.fn(),
  fromMock: vi.fn(),
  logErrorMock: vi.fn(() => "corr_evidence_test"),
}));

vi.mock("@landed/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@landed/db")>();
  return { ...actual, getProjectReportEvidence: evidenceMock };
});
vi.mock("@/lib/observability", () => ({ logError: logErrorMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: fromMock })),
}));

import { ReportQueryError } from "@landed/db";

import { GET } from "./route";

const versionId = "70000000-0000-4000-8000-000000000001";

function request(metric = "qualified_wallets") {
  return new Request(
    `https://landed.test/api/projects/helios/reports/${versionId}/evidence?metric=${metric}`,
  );
}

function context(projectId = "helios") {
  return {
    params: Promise.resolve({ projectId, reportVersionId: versionId }),
  };
}

describe("report evidence route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: vi.fn(async () => ({
            data: { id: "project" },
            error: null,
          })),
        }),
      }),
    });
    evidenceMock.mockResolvedValue([]);
  });

  it("returns only the scoped sanitized evidence path", async () => {
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ paths: [] });
    expect(evidenceMock).toHaveBeenCalledWith(
      expect.anything(),
      "20000000-0000-4000-8000-000000000001",
      versionId,
      "qualified_wallets",
    );
  });

  it("rejects unsupported metrics and projects before database access", async () => {
    expect((await GET(request("revenue_roas"), context())).status).toBe(400);
    expect((await GET(request(), context("foreign"))).status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("keeps permission and infrastructure failures distinct", async () => {
    evidenceMock.mockRejectedValueOnce(
      new ReportQueryError("Restricted", "42501"),
    );
    expect((await GET(request(), context())).status).toBe(403);

    evidenceMock.mockRejectedValueOnce(new Error("database unavailable"));
    const response = await GET(request(), context());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      message: "Evidence could not be prepared.",
      reference: "corr_evidence_test",
    });
  });
});

import { buildSubmissionCampaign } from "@/lib/submission-campaign";
import { beforeEach, describe, expect, it, vi } from "vitest";

const snapshotAccess = vi.hoisted(() => ({
  enabled: vi.fn(() => false),
  authorize: vi.fn(async () => "Judge"),
}));
vi.mock("@/lib/submission-access.server", () => ({
  submissionEnabled: snapshotAccess.enabled,
  authorizeSubmission: snapshotAccess.authorize,
}));

const { createClientMock, getProjectCreatorEvidenceMock, logErrorMock } =
  vi.hoisted(() => ({
    createClientMock: vi.fn(),
    getProjectCreatorEvidenceMock: vi.fn(),
    logErrorMock: vi.fn(() => "corr_creator_test"),
  }));

vi.mock("@landed/db", () => ({
  CreatorQueryError: class CreatorQueryError extends Error {
    code: string | undefined;

    constructor(message: string, code?: string) {
      super(message);
      this.name = "CreatorQueryError";
      this.code = code;
    }
  },
  getProjectCreatorEvidence: getProjectCreatorEvidenceMock,
}));

vi.mock("@/lib/observability", () => ({
  logError: logErrorMock,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

import { CreatorQueryError } from "@landed/db";

import { GET } from "./route";

const creatorId = "40000000-0000-4000-8000-000000000001";

function context(projectId = "helios", requestedCreatorId = creatorId) {
  return {
    params: Promise.resolve({
      projectId,
      creatorId: requestedCreatorId,
    }),
  };
}

describe("creator evidence route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshotAccess.enabled.mockReturnValue(false);
    createClientMock.mockResolvedValue({ name: "server client" });
  });

  it("returns private project-scoped creator evidence", async () => {
    getProjectCreatorEvidenceMock.mockResolvedValue({
      id: creatorId,
      displayName: "Maya / Chain Mode",
    });

    const response = await GET(
      new Request(
        `https://landed.test/api/projects/helios/creators/${creatorId}`,
      ),
      context(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(getProjectCreatorEvidenceMock).toHaveBeenCalledWith(
      { name: "server client" },
      "20000000-0000-4000-8000-000000000001",
      creatorId,
    );
  });

  it("rejects invalid creator identifiers before querying", async () => {
    const response = await GET(
      new Request(
        "https://landed.test/api/projects/helios/creators/not-a-uuid",
      ),
      context("helios", "not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("returns a safe permission response", async () => {
    getProjectCreatorEvidenceMock.mockRejectedValue(
      new CreatorQueryError("denied", "42501"),
    );

    const response = await GET(
      new Request(
        `https://landed.test/api/projects/helios/creators/${creatorId}`,
      ),
      context(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      message: "Creator evidence is not available for this account.",
    });
  });

  it("logs an opaque reference for unexpected failures", async () => {
    const error = new Error("provider detail");
    getProjectCreatorEvidenceMock.mockRejectedValue(error);

    const response = await GET(
      new Request(
        `https://landed.test/api/projects/helios/creators/${creatorId}`,
      ),
      context(),
    );

    expect(response.status).toBe(500);
    expect(logErrorMock).toHaveBeenCalledWith({
      event: "creator_evidence_failed",
      error,
      projectId: "helios",
    });
    expect(await response.json()).toEqual({
      message: "Creator evidence could not be prepared.",
      reference: "corr_creator_test",
    });
  });
});

it("serves the neutral synthetic creator route only after the access check", async () => {
  vi.clearAllMocks();
  snapshotAccess.enabled.mockReturnValue(true);
  const creator = buildSubmissionCampaign().creators[0]!;
  const response = await GET(
    new Request(`https://landed.test/api/projects/demo/creators/${creator.id}`),
    context("demo", creator.id),
  );
  expect(response.status).toBe(200);
  expect(snapshotAccess.authorize).toHaveBeenCalledOnce();
  expect((await response.json()).creator.displayName).toBe(creator.displayName);
  expect(getProjectCreatorEvidenceMock).not.toHaveBeenCalled();
});
it("does not expose a synthetic creator if authorization fails", async () => {
  vi.clearAllMocks();
  snapshotAccess.enabled.mockReturnValue(true);
  snapshotAccess.authorize.mockRejectedValueOnce(new Error("access denied"));
  const creator = buildSubmissionCampaign().creators[0]!;
  await expect(
    GET(new Request("https://landed.test"), context("demo", creator.id)),
  ).rejects.toThrow("access denied");
  expect(getProjectCreatorEvidenceMock).not.toHaveBeenCalled();
});

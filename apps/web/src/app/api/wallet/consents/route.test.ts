import { beforeEach, describe, expect, it, vi } from "vitest";

const { inngestSendMock, logErrorMock, rpcMock } = vi.hoisted(() => ({
  inngestSendMock: vi.fn(),
  logErrorMock: vi.fn(() => "corr_wallet_consent"),
  rpcMock: vi.fn(),
}));

vi.mock("@/inngest/client", () => ({
  inngest: { send: inngestSendMock },
}));

vi.mock("@/lib/observability", () => ({ logError: logErrorMock }));
vi.mock("@/lib/supabase/server", () => {
  class SupabaseServerConfigError extends Error {}
  return {
    createAdminClient: vi.fn(() => ({ rpc: rpcMock })),
    SupabaseServerConfigError,
  };
});

import { GET, POST } from "./route";

const sessionId = "f2000000-0000-4000-8000-000000000001";
const proofId = "f3000000-0000-4000-8000-000000000001";
const consentId = "f4000000-0000-4000-8000-000000000001";
const mappingId = "f5000000-0000-4000-8000-000000000001";

function request(
  body: unknown = { proofId, accepted: true, consentVersion: 1 },
  origin = "https://landed.test",
  cookie = `lnd_session=${sessionId}`,
) {
  return new Request("https://landed.test/api/wallet/consents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
}

describe("wallet measurement consent route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.HELIUS_WEBHOOK_INTEGRATION_ID =
      "f6000000-0000-4000-8000-000000000001";
    inngestSendMock.mockResolvedValue({ ids: ["event-1"] });
    rpcMock.mockImplementation(async (name: string, args: unknown) => {
      if (name === "read_active_wallet_measurement_consent") {
        return { data: [], error: null };
      }
      if (name === "enqueue_solana_reconciliation_job") {
        return {
          data: [
            {
              job_id: (args as { target_job_id: string }).target_job_id,
              status: "queued",
              inserted: true,
            },
          ],
          error: null,
        };
      }
      return {
        data: [
          {
            consent_id: consentId,
            mapping_id: mappingId,
            wallet_address: "So11111111111111111111111111111111111111112",
            eligibility: "accepted",
            accepted_at: "2026-08-11T12:00:00.000+00:00",
            monitoring_ends_at: "2026-08-18T12:00:00.000+00:00",
          },
        ],
        error: null,
      };
    });
  });

  it("recovers only the active mapping bound to the session cookie", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          consent_id: consentId,
          mapping_id: mappingId,
          accepted_at: "2026-08-11T12:00:00.000+00:00",
          monitoring_ends_at: "2026-08-18T12:00:00.000+00:00",
          reconciliation_state: "attention_required",
        },
      ],
      error: null,
    });
    const response = await GET(request(undefined));
    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith(
      "read_active_wallet_measurement_consent",
      { target_anonymous_session_id: sessionId },
    );
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        consentId,
        mappingId,
        state: "already_accepted",
        reconciliationState: "attention_required",
      }),
    );

    expect((await GET(request(undefined, undefined, ""))).status).toBe(204);
  });

  it("records explicit consent and returns the bounded measurement window", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(rpcMock).toHaveBeenCalledWith(
      "accept_wallet_measurement_consent",
      expect.objectContaining({
        target_accepted: true,
        target_anonymous_session_id: sessionId,
        target_consent_version: 1,
        target_proof_id: proofId,
      }),
    );
    expect(rpcMock).toHaveBeenCalledWith(
      "enqueue_solana_reconciliation_job",
      expect.objectContaining({ target_mapping_id: mappingId }),
    );
    expect(inngestSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "landed/solana.reconciliation.requested",
      }),
    );
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        consentId,
        mappingId,
        state: "accepted",
        reconciliationState: "queued",
        historicalLookbackDays: 90,
        monitoringEndsAt: "2026-08-18T12:00:00.000+00:00",
      }),
    );
  });

  it("rejects implicit, unbounded, cross-origin and cookieless consent", async () => {
    expect(
      (await POST(request({ proofId, accepted: false, consentVersion: 1 })))
        .status,
    ).toBe(400);
    expect(
      (
        await POST(
          request({
            proofId,
            accepted: true,
            consentVersion: 1,
            monitorForever: true,
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(request(undefined, "https://attacker.test"))).status,
    ).toBe(403);
    expect((await POST(request(undefined, undefined, ""))).status).toBe(410);
  });

  it("is replay-safe and fails closed for ineligible or invalid evidence", async () => {
    rpcMock.mockImplementationOnce(async () => ({
      data: [
        {
          consent_id: consentId,
          mapping_id: mappingId,
          wallet_address: "So11111111111111111111111111111111111111112",
          eligibility: "already_accepted",
          accepted_at: "2026-08-11T12:00:00.000+00:00",
          monitoring_ends_at: "2026-08-18T12:00:00.000+00:00",
        },
      ],
      error: null,
    }));
    expect((await POST(request())).status).toBe(200);

    rpcMock.mockResolvedValueOnce({
      data: [
        {
          consent_id: null,
          mapping_id: null,
          wallet_address: null,
          eligibility: "not_accepted",
          accepted_at: null,
          monitoring_ends_at: null,
        },
      ],
      error: null,
    });
    expect((await POST(request())).status).toBe(410);

    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    expect((await POST(request())).status).toBe(503);
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("returns the retained mapping when reconciliation needs attention", async () => {
    rpcMock.mockImplementationOnce(async () => ({
      data: [
        {
          consent_id: consentId,
          mapping_id: mappingId,
          wallet_address: "So11111111111111111111111111111111111111112",
          eligibility: "accepted",
          accepted_at: "2026-08-11T12:00:00.000+00:00",
          monitoring_ends_at: "2026-08-18T12:00:00.000+00:00",
        },
      ],
      error: null,
    }));
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    const queueFailure = await POST(request());
    expect(queueFailure.status).toBe(201);
    await expect(queueFailure.json()).resolves.toEqual(
      expect.objectContaining({
        consentId,
        mappingId,
        state: "accepted",
        reconciliationState: "attention_required",
      }),
    );

    rpcMock.mockImplementationOnce(async (name: string, args: unknown) => {
      if (name === "enqueue_solana_reconciliation_job") {
        return {
          data: [
            {
              job_id: (args as { target_job_id: string }).target_job_id,
              status: "queued",
              inserted: true,
            },
          ],
          error: null,
        };
      }
      return {
        data: [
          {
            consent_id: consentId,
            mapping_id: mappingId,
            wallet_address: "So11111111111111111111111111111111111111112",
            eligibility: "already_accepted",
            accepted_at: "2026-08-11T12:00:00.000+00:00",
            monitoring_ends_at: "2026-08-18T12:00:00.000+00:00",
          },
        ],
        error: null,
      };
    });
    inngestSendMock.mockRejectedValueOnce(new Error("dispatch unavailable"));
    const dispatchFailure = await POST(request());
    expect(dispatchFailure.status).toBe(200);
    await expect(dispatchFailure.json()).resolves.toEqual(
      expect.objectContaining({
        consentId,
        mappingId,
        state: "already_accepted",
        reconciliationState: "attention_required",
      }),
    );
  });

  it("returns an unlinkable mapping when provider configuration is missing", async () => {
    delete process.env.HELIUS_WEBHOOK_INTEGRATION_ID;
    const response = await POST(request());
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        consentId,
        mappingId,
        reconciliationState: "attention_required",
      }),
    );
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "wallet_reconciliation_integration_missing",
      }),
    );
  });
});

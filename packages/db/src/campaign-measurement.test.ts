import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/bsk09-rule-resolution.json";
import { resolveCampaignConversionRuleVersion } from "./campaign-measurement";

const input = {
  workspaceId: fixture[0]!.workspace_id,
  projectId: fixture[0]!.project_id,
  campaignId: "80990000-0000-4000-8000-000000000001",
  effectiveAt: "2026-09-20T00:00:00Z",
};
function client(data: unknown = fixture, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { rpc, db: { rpc } as unknown as SupabaseClient };
}
describe("approved campaign measurement lookup", () => {
  it("rejects template-inconsistent matching conditions", async () => {
    const rows = JSON.parse(JSON.stringify(fixture));
    rows[0].match_conditions = { requiresWalletBinding: false };
    await expect(
      resolveCampaignConversionRuleVersion(client(rows).db, input),
    ).rejects.toMatchObject({ code: "invalid_rule" });
  });
  it("checks exclusive rule expiry precisely", async () => {
    const rows = JSON.parse(JSON.stringify(fixture));
    rows[0].effective_until = "2026-09-20T00:00:00.000001+00:00";
    expect(
      (await resolveCampaignConversionRuleVersion(client(rows).db, input))
        .status,
    ).toBe("resolved");
    await expect(
      resolveCampaignConversionRuleVersion(client(rows).db, {
        ...input,
        effectiveAt: rows[0].effective_until,
      }),
    ).rejects.toMatchObject({ code: "invalid_rule" });
  });
  it("compares equivalent timezone offsets and rejects an earlier instant", async () => {
    const rows = JSON.parse(JSON.stringify(fixture));
    rows[0].effective_from = "2026-09-20T01:00:00.000001+01:00";
    await expect(
      resolveCampaignConversionRuleVersion(client(rows).db, input),
    ).rejects.toMatchObject({ code: "invalid_rule" });
    expect(
      (
        await resolveCampaignConversionRuleVersion(client(rows).db, {
          ...input,
          effectiveAt: "2026-09-20T00:00:00.000001Z",
        })
      ).status,
    ).toBe("resolved");
  });
  it("rejects finer-than-database precision before querying", async () => {
    const c = client();
    await expect(
      resolveCampaignConversionRuleVersion(c.db, {
        ...input,
        effectiveAt: "2026-09-20T00:00:00.0000001Z",
      }),
    ).rejects.toThrow();
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it("reads actual PostgreSQL output without changing rule, precision or match conditions", async () => {
    const c = client();
    const result = await resolveCampaignConversionRuleVersion(c.db, input);
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw Error("missing rule");
    expect(result.rule.id).toBe(fixture[0]!.id);
    expect(result.rule.match_conditions).toEqual(fixture[0]!.match_conditions);
    expect(result.rule.effective_from).toBe(fixture[0]!.effective_from);
    expect(c.rpc).toHaveBeenCalledExactlyOnceWith(
      "resolve_campaign_conversion_rule_version",
      {
        target_project_id: input.projectId,
        target_campaign_id: input.campaignId,
        target_effective_at: input.effectiveAt,
      },
    );
  });
  it("labels outside-window absence instead of reporting zero or selecting another rule", async () => {
    const c = client([]);
    expect(await resolveCampaignConversionRuleVersion(c.db, input)).toEqual({
      status: "outside_approved_window",
    });
    expect(c.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, [{}], [...fixture, ...fixture]])(
    "rejects malformed or multiple results %j",
    async (data) => {
      await expect(
        resolveCampaignConversionRuleVersion(client(data).db, input),
      ).rejects.toMatchObject({ code: "invalid_rule" });
    },
  );
  it.each([
    "workspace_id",
    "project_id",
    "template_code",
    "chain",
    "requires_wallet_binding",
    "minimum_finality",
    "revenue_mapping",
    "attribution_window_seconds",
    "evidence_capability",
    "match_conditions",
    "effective_from",
  ])("rejects invalid %s", async (key) => {
    const rows = JSON.parse(JSON.stringify(fixture));
    rows[0][key] = null;
    await expect(
      resolveCampaignConversionRuleVersion(client(rows).db, input),
    ).rejects.toMatchObject({ code: "invalid_rule" });
  });
  it.each(["workspaceId", "projectId"])("rejects foreign %s", async (key) => {
    await expect(
      resolveCampaignConversionRuleVersion(client().db, {
        ...input,
        [key]: "20990000-0000-4000-8000-000000000099",
      }),
    ).rejects.toMatchObject({ code: "invalid_rule" });
  });
  it("preserves sub-millisecond database timestamps", async () => {
    const rows = JSON.parse(JSON.stringify(fixture));
    rows[0].effective_from = "2026-09-01T00:00:00.000001+00:00";
    const result = await resolveCampaignConversionRuleVersion(
      client(rows).db,
      input,
    );
    expect(result.status === "resolved" && result.rule.effective_from).toBe(
      rows[0].effective_from,
    );
  });
  it("rejects inconsistent finality even when each field is valid alone", async () => {
    const rows = JSON.parse(JSON.stringify(fixture));
    rows[0].minimum_finality = "not_applicable";
    await expect(
      resolveCampaignConversionRuleVersion(client(rows).db, input),
    ).rejects.toMatchObject({ code: "invalid_rule" });
  });
  it.each(["22023", "42501", "55000"])(
    "keeps %s distinct from an empty period without leaking details",
    async (code) => {
      const c = client(null, { code, message: "internal protected details" });
      await expect(
        resolveCampaignConversionRuleVersion(c.db, input),
      ).rejects.toMatchObject({
        code,
        message: "Approved campaign measurement could not be prepared.",
      });
      expect(c.rpc).toHaveBeenCalledTimes(1);
    },
  );
  it("sanitizes transport failures without retry or fallback", async () => {
    const c = client();
    c.rpc.mockRejectedValue(new Error("internal transport details"));
    await expect(
      resolveCampaignConversionRuleVersion(c.db, input),
    ).rejects.toMatchObject({
      code: "transport_error",
      message: "Approved campaign measurement could not be prepared.",
    });
    expect(c.rpc).toHaveBeenCalledTimes(1);
  });
  it("validates input before requesting data", async () => {
    const c = client();
    await expect(
      resolveCampaignConversionRuleVersion(c.db, {
        ...input,
        effectiveAt: "infinity",
      }),
    ).rejects.toThrow();
    expect(c.rpc).not.toHaveBeenCalled();
  });
});

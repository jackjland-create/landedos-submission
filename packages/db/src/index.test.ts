import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  BasketQueryError,
  CampaignQueryError,
  ConversionRuleQueryError,
  CreatorQueryError,
  getProjectBasket,
  getProjectCampaign,
  getProjectConversionReplayJobs,
  getProjectConversionRule,
  getProjectCreator,
  getProjectCreatorEvidence,
  listProjectCreators,
  listProjectCampaigns,
} from "./index";

const projectId = "20000000-0000-4000-8000-000000000001";
const creatorId = "40000000-0000-4000-8000-000000000001";

const creatorRow = {
  id: creatorId,
  workspace_id: "10000000-0000-4000-8000-000000000001",
  project_id: projectId,
  display_name: "Maya / Chain Mode",
  relationship_status: "active",
  country_code: "GB",
  language_codes: ["en"],
  created_at: "2026-07-29T12:00:00.000Z",
  updated_at: "2026-07-29T12:00:00.000Z",
  creator_channels: [
    {
      id: "50000000-0000-4000-8000-000000000001",
      channel_type: "x",
      handle: "@chainmode",
      profile_url: "https://x.com/chainmode",
      language_code: "en",
      audience_size: 142000,
      observed_at: "2026-07-01T12:00:00.000Z",
      source_label: "Seeded demonstration evidence",
      is_primary: true,
    },
  ],
  creator_tags: [
    {
      tags: {
        id: "60000000-0000-4000-8000-000000000001",
        name: "Solana",
        slug: "solana",
      },
    },
  ],
  creator_rate_quotes: [
    {
      id: "80000000-0000-4000-8000-000000000001",
      package_label: "Launch package",
      deliverable_summary: "One X thread and one short-form video",
      amount_minor: "460000",
      currency_code: "GBP",
      quoted_at: "2026-07-15T12:00:00.000Z",
      valid_until: "2026-08-15T12:00:00.000Z",
      source_label: "Seeded commercial evidence",
    },
  ],
};

const conversionRuleRow = {
  id: "a1000000-0000-4000-8000-000000000001",
  workspace_id: "10000000-0000-4000-8000-000000000001",
  project_id: projectId,
  stable_key: "primary-outcome",
  created_by: "30000000-0000-4000-8000-000000000001",
  created_at: "2026-08-12T13:00:00+01:00",
  conversion_rule_versions: [
    {
      id: "a2000000-0000-4000-8000-000000000002",
      rule_id: "a1000000-0000-4000-8000-000000000001",
      workspace_id: "10000000-0000-4000-8000-000000000001",
      project_id: projectId,
      version: 2,
      template_code: "programme_action",
      name: "Deposit completed",
      description:
        "Count a finalized customer programme deposit after consent.",
      effective_from: "2026-08-13T00:00:00+01:00",
      effective_until: null,
      chain: "solana",
      requires_wallet_binding: true,
      minimum_finality: "finalized",
      value_mapping: "none",
      revenue_mapping: "none",
      attribution_window_seconds: 604800,
      attribution_model: "last_eligible_creator_touch",
      program_id: "11111111111111111111111111111111",
      event_discriminator: "deposit_completed",
      evidence_capability: "requires_programme_decoder",
      change_reason: "Prepare the customer programme definition",
      created_by: "30000000-0000-4000-8000-000000000001",
      created_at: "2026-08-12T14:00:00+01:00",
    },
    {
      id: "a2000000-0000-4000-8000-000000000001",
      rule_id: "a1000000-0000-4000-8000-000000000001",
      workspace_id: "10000000-0000-4000-8000-000000000001",
      project_id: projectId,
      version: 1,
      template_code: "first_qualifying_transaction",
      name: "First qualifying transaction",
      description: "Count the first finalized Solana transfer after consent.",
      effective_from: "2026-08-12T12:00:00Z",
      effective_until: null,
      chain: "solana",
      requires_wallet_binding: true,
      minimum_finality: "finalized",
      value_mapping: "transfer_amount",
      revenue_mapping: "none",
      attribution_window_seconds: 604800,
      attribution_model: "last_eligible_creator_touch",
      program_id: null,
      event_discriminator: null,
      evidence_capability: "ready",
      configured_environment: "devnet",
      destination_address: "Vote111111111111111111111111111111111111111",
      native_amount_lamports: 1,
      change_reason: "Create the first conversion definition",
      created_by: "30000000-0000-4000-8000-000000000001",
      created_at: "2026-08-12T12:00:00Z",
    },
  ],
};

const conversionReplayJobRow = {
  id: "a4000000-0000-4000-8000-000000000001",
  rule_id: "a1000000-0000-4000-8000-000000000001",
  rule_version_id: "a2000000-0000-4000-8000-000000000001",
  workspace_id: "10000000-0000-4000-8000-000000000001",
  project_id: projectId,
  status: "pending",
  affected_campaign_count: 2,
  requested_by: "30000000-0000-4000-8000-000000000001",
  requested_at: "2026-08-12T13:00:00+01:00",
  conversion_replay_runs: [
    {
      id: "a5000000-0000-4000-8000-000000000001",
      status: "completed",
      approved_at: "2026-08-13T14:00:00+01:00",
      source_started_at: "2026-08-12T12:00:00Z",
      source_ended_at: "2026-08-13T13:00:00Z",
      candidate_count: 4,
      matched_count: 2,
      unmatched_count: 2,
      report_count: 2,
      failure_code: null,
      conversion_replay_campaigns: [
        {
          campaign_id: "30000000-0000-4000-8000-000000000001",
          campaign: { name: "Helios launch" },
          status: "completed",
          prior_report_version: {
            id: "d1000000-0000-4000-8000-000000000001",
            report_id: "d2000000-0000-4000-8000-000000000001",
            version: 1,
          },
          output_report_version: {
            id: "d1000000-0000-4000-8000-000000000002",
            report_id: "d2000000-0000-4000-8000-000000000001",
            version: 2,
          },
        },
      ],
    },
  ],
};

function listClient(
  result: { data: unknown; error: { code?: string } | null },
  previewResult: {
    data: unknown;
    error: { code?: string } | null;
  } = {
    data: [
      {
        replay_job_id: conversionReplayJobRow.id,
        eligible_campaign_count: 1,
      },
    ],
    error: null,
  },
) {
  const order = vi.fn(async () => result);
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn(async () => previewResult);

  return {
    client: { from, rpc } as unknown as SupabaseClient,
    eq,
    from,
    order,
    rpc,
    select,
  };
}

function detailClient(result: {
  data: unknown;
  error: { code?: string } | null;
}) {
  const maybeSingle = vi.fn(async () => result);
  const query = {
    eq: vi.fn(),
    maybeSingle,
  };
  query.eq.mockImplementation(() => query);
  const select = vi.fn(() => query);
  const from = vi.fn(() => ({ select }));

  return {
    client: { from } as unknown as SupabaseClient,
    eq: query.eq,
    from,
    maybeSingle,
    select,
  };
}

function evidenceClient(
  result: {
    data: unknown;
    error: { code?: string } | null;
  },
  permissionResult: {
    data: boolean | null;
    error: { code?: string } | null;
  },
) {
  const query = detailClient(result);
  const rpc = vi.fn(async () => permissionResult);

  return {
    ...query,
    client: { from: query.from, rpc } as unknown as SupabaseClient,
    rpc,
  };
}

describe("conversion rule queries", () => {
  it("maps immutable versions newest-first and canonicalizes evidence time", async () => {
    const query = detailClient({ data: conversionRuleRow, error: null });
    const rule = await getProjectConversionRule(query.client, projectId);

    expect(rule).toEqual(
      expect.objectContaining({
        id: conversionRuleRow.id,
        stableKey: "primary-outcome",
      }),
    );
    expect(rule?.createdAt).toBe("2026-08-12T12:00:00.000Z");
    expect(rule?.versions.map(({ version }) => version)).toEqual([2, 1]);
    expect(rule?.versions[0]).toEqual(
      expect.objectContaining({
        templateCode: "programme_action",
        evidenceCapability: "requires_programme_decoder",
        effectiveFrom: "2026-08-12T23:00:00.000Z",
      }),
    );
    expect(rule?.versions[1]).toEqual(
      expect.objectContaining({
        configuredEnvironment: "devnet",
        destinationAddress: "Vote111111111111111111111111111111111111111",
        nativeAmountLamports: "1",
      }),
    );
    expect(query.from).toHaveBeenCalledWith("conversion_rules");
    expect(query.eq).toHaveBeenNthCalledWith(1, "project_id", projectId);
    expect(query.eq).toHaveBeenNthCalledWith(
      2,
      "stable_key",
      "primary-outcome",
    );
  });

  it("returns no rule for a readable project without a definition", async () => {
    const query = detailClient({ data: null, error: null });
    await expect(
      getProjectConversionRule(query.client, projectId),
    ).resolves.toBeNull();
  });

  it("returns a safe domain error for a conversion query failure", async () => {
    const query = detailClient({ data: null, error: { code: "42501" } });
    await expect(
      getProjectConversionRule(query.client, projectId),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ConversionRuleQueryError>>({
        name: "ConversionRuleQueryError",
        code: "42501",
      }),
    );
  });

  it("maps pending and executed replay work without hiding unknown counts", async () => {
    const query = listClient({ data: [conversionReplayJobRow], error: null });
    const jobs = await getProjectConversionReplayJobs(query.client, projectId);

    expect(jobs).toEqual([
      expect.objectContaining({
        id: conversionReplayJobRow.id,
        status: "pending",
        affectedCampaignCount: 2,
        eligibleCampaignCount: 1,
        requestedAt: "2026-08-12T12:00:00.000Z",
        execution: expect.objectContaining({
          status: "completed",
          candidateCount: 4,
          matchedCount: 2,
          unmatchedCount: 2,
          reportCount: 2,
          approvedAt: "2026-08-13T13:00:00.000Z",
          comparisons: [
            {
              campaignId: "30000000-0000-4000-8000-000000000001",
              campaignName: "Helios launch",
              status: "completed",
              baselineVersion: 1,
              reportId: "d2000000-0000-4000-8000-000000000001",
              replayVersion: 2,
            },
          ],
        }),
      }),
    ]);
    expect(query.from).toHaveBeenCalledWith("conversion_rule_replay_jobs");
    expect(query.eq).toHaveBeenCalledWith("project_id", projectId);
    expect(query.order).toHaveBeenCalledWith("requested_at", {
      ascending: false,
    });
    expect(query.rpc).toHaveBeenCalledWith(
      "get_project_conversion_replay_previews",
      { target_project_id: projectId },
    );
  });

  it("maps a replay request that has not been approved yet", async () => {
    const query = listClient({
      data: [
        {
          ...conversionReplayJobRow,
          conversion_replay_runs: [],
        },
      ],
      error: null,
    });

    await expect(
      getProjectConversionReplayJobs(query.client, projectId),
    ).resolves.toEqual([
      expect.objectContaining({ execution: null, status: "pending" }),
    ]);
  });

  it("fails closed when replay eligibility cannot be matched to a retained job", async () => {
    const query = listClient(
      { data: [conversionReplayJobRow], error: null },
      { data: [], error: null },
    );

    await expect(
      getProjectConversionReplayJobs(query.client, projectId),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ConversionRuleQueryError>>({
        name: "ConversionRuleQueryError",
        code: "REPLAY_PREVIEW_MISSING",
      }),
    );
  });

  it("returns a safe domain error for replay history failures", async () => {
    const query = listClient({ data: null, error: { code: "42501" } });
    await expect(
      getProjectConversionReplayJobs(query.client, projectId),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ConversionRuleQueryError>>({
        name: "ConversionRuleQueryError",
        code: "42501",
      }),
    );
  });
});

describe("creator queries", () => {
  it("maps project-scoped creator evidence", async () => {
    const query = listClient({ data: [creatorRow], error: null });
    const creators = await listProjectCreators(query.client, projectId);

    expect(creators).toEqual([
      expect.objectContaining({
        id: creatorId,
        displayName: "Maya / Chain Mode",
        relationshipStatus: "active",
      }),
    ]);
    expect(creators[0]?.channels[0]?.handle).toBe("@chainmode");
    expect(creators[0]?.tags[0]?.slug).toBe("solana");
    expect(creators[0]?.currentRate?.amountMinor).toBe("460000");
    expect(query.from).toHaveBeenCalledWith("creators");
    expect(query.eq).toHaveBeenCalledWith("project_id", projectId);
  });

  it("normalizes Postgres timestamp offsets to canonical UTC evidence", async () => {
    const offsetRow = {
      ...creatorRow,
      created_at: "2026-07-29T13:00:00+01:00",
      updated_at: "2026-07-29T12:00:00+00:00",
      creator_channels: [
        {
          ...creatorRow.creator_channels[0],
          observed_at: "2026-07-01T13:00:00+01:00",
        },
      ],
    };
    const query = listClient({ data: [offsetRow], error: null });
    const [creator] = await listProjectCreators(query.client, projectId);

    expect(creator?.createdAt).toBe("2026-07-29T12:00:00.000Z");
    expect(creator?.updatedAt).toBe("2026-07-29T12:00:00.000Z");
    expect(creator?.channels[0]?.observedAt).toBe("2026-07-01T12:00:00.000Z");
  });

  it("returns null when creator evidence is absent", async () => {
    const query = detailClient({ data: null, error: null });
    await expect(
      getProjectCreator(query.client, projectId, creatorId),
    ).resolves.toBeNull();
    expect(query.eq).toHaveBeenNthCalledWith(1, "project_id", projectId);
    expect(query.eq).toHaveBeenNthCalledWith(2, "id", creatorId);
  });

  it("maps rate history and protected contact evidence for managers", async () => {
    const query = evidenceClient(
      {
        data: {
          ...creatorRow,
          profile_summary: "Consumer-focused Solana educator.",
          profile_observed_at: "2026-07-15T13:00:00+01:00",
          profile_source_label: "Seeded workspace profile",
          creator_contacts: [
            {
              id: "70000000-0000-4000-8000-000000000001",
              contact_name: "Maya campaign desk",
              contact_role: "Commercial contact",
              email: "maya-chainmode@example.test",
              observed_at: "2026-07-15T13:00:00+01:00",
              source_label: "Seeded demo contact",
            },
          ],
        },
        error: null,
      },
      { data: true, error: null },
    );

    const creator = await getProjectCreatorEvidence(
      query.client,
      projectId,
      creatorId,
    );

    expect(creator?.contactAccess).toBe("available");
    expect(creator?.profileObservedAt).toBe("2026-07-15T12:00:00.000Z");
    expect(creator?.profileSourceLabel).toBe("Seeded workspace profile");
    expect(creator?.contact?.observedAt).toBe("2026-07-15T12:00:00.000Z");
    expect(creator?.rateQuotes[0]?.packageLabel).toBe("Launch package");
    expect(query.rpc).toHaveBeenCalledWith("can_manage_project", {
      target_project_id: projectId,
      target_workspace_id: creatorRow.workspace_id,
    });
  });

  it("does not expose contact evidence to a restricted member", async () => {
    const query = evidenceClient(
      {
        data: {
          ...creatorRow,
          profile_summary: null,
          profile_observed_at: null,
          profile_source_label: null,
          creator_contacts: [],
        },
        error: null,
      },
      { data: false, error: null },
    );

    const creator = await getProjectCreatorEvidence(
      query.client,
      projectId,
      creatorId,
    );

    expect(creator?.contactAccess).toBe("restricted");
    expect(creator?.contact).toBeNull();
  });

  it("returns a safe domain error for database failures", async () => {
    const query = listClient({ data: null, error: { code: "42501" } });
    await expect(listProjectCreators(query.client, projectId)).rejects.toEqual(
      expect.objectContaining<Partial<CreatorQueryError>>({
        name: "CreatorQueryError",
        code: "42501",
        message: "Creator directory could not be prepared.",
      }),
    );
  });

  it("rejects audience sizes outside JavaScript's safe integer range", async () => {
    const unsafeRow = {
      ...creatorRow,
      creator_channels: [
        {
          ...creatorRow.creator_channels[0],
          audience_size: "9007199254740992",
        },
      ],
    };
    const query = listClient({ data: [unsafeRow], error: null });

    await expect(listProjectCreators(query.client, projectId)).rejects.toThrow(
      "audience_size exceeds the JavaScript safe integer range",
    );
  });

  it("rejects unsafe profile URL schemes before rendering", async () => {
    const unsafeRow = {
      ...creatorRow,
      creator_channels: [
        {
          ...creatorRow.creator_channels[0],
          profile_url: "javascript:alert(document.domain)",
        },
      ],
    };
    const query = listClient({ data: [unsafeRow], error: null });

    await expect(listProjectCreators(query.client, projectId)).rejects.toThrow(
      "profile_url must use HTTP or HTTPS",
    );
  });

  it("rejects malformed contact emails at the API boundary", async () => {
    const query = evidenceClient(
      {
        data: {
          ...creatorRow,
          profile_summary: null,
          profile_observed_at: null,
          profile_source_label: null,
          creator_contacts: [
            {
              id: "70000000-0000-4000-8000-000000000001",
              contact_name: "Malformed contact",
              contact_role: null,
              email: "a@@b",
              observed_at: "2026-07-15T12:00:00.000Z",
              source_label: "Hostile fixture",
            },
          ],
        },
        error: null,
      },
      { data: true, error: null },
    );

    await expect(
      getProjectCreatorEvidence(query.client, projectId, creatorId),
    ).rejects.toThrow();
  });
});

describe("basket queries", () => {
  it.each([1, 2])(
    "maps shared scenario packages and version%s approval without commercial guesses",
    async (recordVersion) => {
      const basketId = "90000000-0000-4000-8000-000000000001";
      const scenarioId = "91000000-0000-4000-8000-000000000001";
      const packageId = "92000000-0000-4000-8000-000000000001";

      function filteredResult(result: {
        data: unknown;
        error: { code?: string } | null;
      }) {
        const query = {
          eq: vi.fn(),
          limit: vi.fn(),
          maybeSingle: vi.fn(async () => result),
          order: vi.fn(),
          then: (
            resolve: (value: typeof result) => unknown,
            reject?: (reason: unknown) => unknown,
          ) => Promise.resolve(result).then(resolve, reject),
        };
        query.eq.mockImplementation(() => query);
        query.limit.mockImplementation(() => query);
        query.order.mockImplementation(() => query);
        return query;
      }

      const basketQuery = filteredResult({
        data: {
          id: basketId,
          workspace_id: creatorRow.workspace_id,
          project_id: projectId,
          name: "Helios roster",
          objective: null,
          outcome_metric: null,
          outcome_baseline_units: null,
          outcome_target_units: null,
          outcome_currency_code: null,
          created_at: "2026-07-30T13:00:00+01:00",
          updated_at: "2026-07-30T12:00:00+00:00",
        },
        error: null,
      });
      const scenarioQuery = filteredResult({
        data: [
          { id: scenarioId, code: "A", name: "Focused authority" },
          {
            id: "91000000-0000-4000-8000-000000000002",
            code: "B",
            name: "Broad reach",
          },
          {
            id: "91000000-0000-4000-8000-000000000003",
            code: "C",
            name: "Proof first",
          },
        ],
        error: null,
      });
      const packageQuery = filteredResult({
        data: [
          {
            id: packageId,
            creator_id: creatorId,
            source_rate_quote_id: "80000000-0000-4000-8000-000000000001",
            package_label: "Launch package",
            deliverable_summary: "One X thread and one short-form video",
            compensation_lines: [
              {
                id: "93000000-0000-4000-8000-000000000001",
                asset_type: "cash",
                compensation_model: "fixed",
                amount_minor: "125000",
                currency_code: "GBP",
                token_mint: null,
                token_amount_raw: null,
                token_decimals: null,
                unit_price_usd: null,
                price_source: null,
                valued_at: null,
                variable_unit: null,
                created_at: "2026-08-04T12:00:00+00:00",
                updated_at: "2026-08-04T12:00:00+00:00",
              },
              {
                id: "93000000-0000-4000-8000-000000000002",
                asset_type: "token",
                compensation_model: "variable",
                amount_minor: null,
                currency_code: null,
                token_mint: "So11111111111111111111111111111111111111112",
                token_amount_raw: "12500000000000",
                token_decimals: 9,
                unit_price_usd: "0.042500000000000000",
                price_source: "Project treasury policy",
                valued_at: "2026-08-04T12:00:00+00:00",
                variable_unit: "qualified wallet",
                created_at: "2026-08-04T12:01:00+00:00",
                updated_at: "2026-08-04T12:01:00+00:00",
              },
            ],
            creators: {
              display_name: "Maya / Chain Mode",
              creator_channels: [
                {
                  channel_type: "x",
                  handle: "@chainmode",
                  audience_size: "142000",
                  observed_at: "2026-07-01T12:00:00+00:00",
                  source_label: "Seeded demonstration evidence",
                  is_primary: true,
                },
              ],
            },
          },
        ],
        error: null,
      });
      const assignmentQuery = filteredResult({
        data: [{ scenario_id: scenarioId, package_id: packageId }],
        error: null,
      });
      const approvalQuery = filteredResult({
        data: {
          id: "94000000-0000-4000-8000-000000000001",
          scenario_id: scenarioId,
          version: 1,
          approved_by: "30000000-0000-4000-8000-000000000001",
          approved_at: "2026-08-05T00:30:00+01:00",
          ...(recordVersion === 2 ? { approval_record_version: 2 } : {}),
          approval_reason:
            recordVersion === 2 ? null : "Approved for the pilot launch",
          snapshot_hash:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          basket_scenarios: {
            code: "A",
            name: "Focused authority",
          },
        },
        error: null,
      });
      const from = vi.fn((table: string) => ({
        select: vi.fn(() => {
          if (table === "baskets") return basketQuery;
          if (table === "basket_scenarios") return scenarioQuery;
          if (table === "creator_packages") return packageQuery;
          if (table === "commercial_plan_versions") return approvalQuery;
          return assignmentQuery;
        }),
      }));
      const rpc = vi.fn().mockResolvedValue({
        data: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        error: null,
      });
      const client = { from, rpc } as unknown as SupabaseClient;

      const basket = await getProjectBasket(client, projectId, basketId);

      expect(basket).toEqual(
        expect.objectContaining({
          id: basketId,
          objective: null,
          outcomeProfile: null,
          latestApproval: expect.objectContaining({
            scenarioCode: "A",
            version: 1,
            reason:
              recordVersion === 2 ? null : "Approved for the pilot launch",
            ...(recordVersion === 2 ? { approvalRecordVersion: 2 } : {}),
          }),
          latestApprovalIsCurrent: true,
          createdAt: "2026-07-30T12:00:00.000Z",
        }),
      );
      expect(basket?.scenarios[0]?.packageIds).toEqual([packageId]);
      expect(rpc).toHaveBeenCalledWith(
        recordVersion === 2
          ? "get_selected_basket_commercial_hash"
          : "get_basket_scenario_commercial_hash",
        {
          target_project_id: projectId,
          target_basket_id: basketId,
          ...(recordVersion === 2
            ? { target_plan_id: "94000000-0000-4000-8000-000000000001" }
            : { target_scenario_id: scenarioId }),
        },
      );
      expect(basket?.packages[0]).toEqual(
        expect.objectContaining({
          creatorName: "Maya / Chain Mode",
          creatorHandle: "@chainmode",
          audience: expect.objectContaining({
            channelType: "x",
            size: 142000,
          }),
          compensationLines: [
            expect.objectContaining({
              assetType: "cash",
              amountMinor: "125000",
            }),
            expect.objectContaining({
              assetType: "token",
              tokenAmountRaw: "12500000000000",
              variableUnit: "qualified wallet",
            }),
          ],
        }),
      );
    },
  );

  it("returns a safe basket-domain error", async () => {
    const query = detailClient({
      data: null,
      error: { code: "42501" },
    });

    await expect(
      getProjectBasket(
        query.client,
        projectId,
        "90000000-0000-4000-8000-000000000001",
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<BasketQueryError>>({
        name: "BasketQueryError",
        code: "42501",
      }),
    );
  });
});

describe("campaign queries", () => {
  const campaignId = "a1000000-0000-4000-8000-000000000001";
  const campaignRow = {
    id: campaignId,
    workspace_id: "10000000-0000-4000-8000-000000000001",
    project_id: projectId,
    basket_id: "90000000-0000-4000-8000-000000000001",
    commercial_plan_version_id: "a2000000-0000-4000-8000-000000000001",
    name: "Helios roster",
    objective: "Increase qualified wallets",
    outcome_metric: "qualified_wallets",
    outcome_baseline_units: "50",
    outcome_target_units: "150",
    outcome_currency_code: null,
    status: "approved",
    created_by: "30000000-0000-4000-8000-000000000001",
    created_at: "2026-08-05T12:00:00+00:00",
    updated_at: "2026-08-05T12:00:00+00:00",
    commercial_plan_versions: { version: 1 },
    campaign_creators: [
      {
        id: "a3000000-0000-4000-8000-000000000001",
        creator_id: creatorId,
        source_package_id: "81000000-0000-4000-8000-000000000001",
        roster_position: 1,
        package_label: "Launch package",
        deliverable_summary: "One launch thread",
        commercial_terms: {
          id: "81000000-0000-4000-8000-000000000001",
          creatorId,
          packageLabel: "Launch package",
          deliverableSummary: "One launch thread",
          sourceRateQuoteId: null,
          compensationLines: [
            {
              id: "a4000000-0000-4000-8000-000000000001",
              assetType: "cash",
              model: "fixed",
              amountMinor: "460000",
              currencyCode: "GBP",
            },
          ],
        },
        terms_hash:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        created_at: "2026-08-05T12:00:00+00:00",
        creators: {
          display_name: "Maya / Chain Mode",
          creator_channels: [{ handle: "@chainmode", is_primary: true }],
        },
      },
    ],
    campaign_brief_versions: [
      {
        id: "a8000000-0000-4000-8000-000000000001",
        version: 1,
        request_id: "a9000000-0000-4000-8000-000000000001",
        status: "draft",
        objective: "Increase qualified wallets",
        audience: null,
        key_message: null,
        creator_direction: null,
        compliance_notes: null,
        reason: "Initial brief created from campaign objective",
        actor_user_id: "30000000-0000-4000-8000-000000000001",
        created_at: "2026-08-05T12:00:00+00:00",
      },
    ],
    content_assets: [
      {
        id: "a5000000-0000-4000-8000-000000000001",
        campaign_creator_id: "a3000000-0000-4000-8000-000000000001",
        creator_id: creatorId,
        asset_index: 1,
        label: "One launch thread",
        status: "planned",
        submission_url: null,
        published_url: null,
        created_at: "2026-08-05T12:00:00+00:00",
        updated_at: "2026-08-05T12:00:00+00:00",
        content_asset_publication_evidence: [],
        tracked_links: [],
        content_asset_activity: [
          {
            id: "aa000000-0000-4000-8000-000000000001",
            request_id: "ab000000-0000-4000-8000-000000000001",
            actor_user_id: "30000000-0000-4000-8000-000000000001",
            from_status: null,
            to_status: "planned",
            evidence_url: null,
            note: "Initial content commitment materialized",
            created_at: "2026-08-05T12:00:00+00:00",
          },
        ],
      },
    ],
    campaign_activity: [
      {
        id: "a7000000-0000-4000-8000-000000000001",
        transition_request_id: "a6000000-0000-4000-8000-000000000001",
        actor_user_id: "30000000-0000-4000-8000-000000000001",
        from_status: "draft",
        to_status: "approved",
        reason: "Commercial plan approved",
        created_at: "2026-08-05T12:00:00+00:00",
      },
    ],
  };

  it("maps immutable roster terms and planned content", async () => {
    const query = listClient({ data: [campaignRow], error: null });
    const campaigns = await listProjectCampaigns(query.client, projectId);

    expect(campaigns[0]).toEqual(
      expect.objectContaining({
        id: campaignId,
        commercialPlanVersion: 1,
        status: "approved",
        briefVersions: [
          expect.objectContaining({
            version: 1,
            status: "draft",
            audience: null,
          }),
        ],
        roster: [
          expect.objectContaining({
            creatorHandle: "@chainmode",
            rosterPosition: 1,
            termsHash:
              "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          }),
        ],
        contentAssets: [
          expect.objectContaining({
            status: "planned",
            assetIndex: 1,
            submissionUrl: null,
            trackedLinks: [],
            activity: [
              expect.objectContaining({
                fromStatus: null,
                toStatus: "planned",
              }),
            ],
          }),
        ],
        activity: [
          expect.objectContaining({
            fromStatus: "draft",
            toStatus: "approved",
            reason: "Commercial plan approved",
          }),
        ],
      }),
    );
    expect(query.from).toHaveBeenCalledWith("campaigns");
  });

  it("maps versioned publication media without losing its source", async () => {
    const retained = {
      ...campaignRow,
      content_assets: campaignRow.content_assets.map((asset) => ({
        ...asset,
        status: "published",
        published_url: "https://x.com/chainmode/status/1",
        content_asset_publication_evidence: [
          {
            id: "ac000000-0000-4000-8000-000000000001",
            request_id: "ad000000-0000-4000-8000-000000000001",
            version: 1,
            platform: "x",
            published_url: "https://x.com/chainmode/status/1",
            published_at: "2026-08-05T12:30:00+00:00",
            thumbnail_status: "available",
            thumbnail_url: "https://images.example.test/chainmode.jpg",
            thumbnail_unavailable_reason: null,
            source_label: "Sanitized publication monitor",
            observed_at: "2026-08-05T12:31:00+00:00",
            created_at: "2026-08-05T12:31:00+00:00",
          },
        ],
      })),
    };
    const query = listClient({ data: [retained], error: null });
    const campaigns = await listProjectCampaigns(query.client, projectId);

    expect(campaigns[0]?.contentAssets[0]?.publicationEvidence[0]).toEqual(
      expect.objectContaining({
        platform: "x",
        thumbnailStatus: "available",
        sourceLabel: "Sanitized publication monitor",
      }),
    );
  });

  it("loads one project-scoped campaign and returns permission failures safely", async () => {
    const ready = detailClient({ data: campaignRow, error: null });
    const campaign = await getProjectCampaign(
      ready.client,
      projectId,
      campaignId,
    );

    expect(campaign?.roster[0]?.commercialTerms.compensationLines[0]).toEqual(
      expect.objectContaining({ amountMinor: "460000" }),
    );

    const denied = detailClient({ data: null, error: { code: "42501" } });
    await expect(
      getProjectCampaign(denied.client, projectId, campaignId),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CampaignQueryError>>({
        name: "CampaignQueryError",
        code: "42501",
      }),
    );
  });

  it("summarizes eligible redirects separately from ineligible attempts", async () => {
    const rowWithClickEvidence = {
      ...campaignRow,
      content_assets: campaignRow.content_assets.map((asset) => ({
        ...asset,
        tracked_links: [
          {
            id: "d1000000-0000-4000-8000-000000000001",
            generation_request_id: "d2000000-0000-4000-8000-000000000001",
            destination_url: "https://helios.example.test/start",
            project_tracking_destination_hosts: { revoked_at: null },
            key_version: 1,
            expires_at: "2026-09-10T12:00:00+00:00",
            issued_by: "30000000-0000-4000-8000-000000000001",
            issued_at: "2026-08-10T12:00:00+00:00",
            revoked_at: null,
            revoked_by: null,
            revocation_request_id: null,
            revocation_reason: null,
            tracked_link_click_summaries: {
              eligible_redirect_count: 1,
              ineligible_attempt_count: 1,
              total_attempt_count: 2,
              first_observed_at: "2026-08-10T12:30:00+00:00",
              last_observed_at: "2026-08-10T12:45:00+00:00",
            },
            tracked_link_click_quality_summaries: [
              {
                rule_version: 1,
                duplicate_window_seconds: 1800,
                qualified_click_count: 1,
                duplicate_click_count: 0,
                rejected_click_count: 1,
                total_assessed_count: 2,
                first_assessed_at: "2026-08-10T12:30:01+00:00",
                last_assessed_at: "2026-08-10T12:45:01+00:00",
              },
            ],
            tracked_link_anonymous_session_summaries: {
              session_count: 1,
              bound_click_count: 1,
              first_created_at: "2026-08-10T12:30:02+00:00",
              last_seen_at: "2026-08-10T12:30:02+00:00",
            },
          },
        ],
      })),
    };
    const query = listClient({ data: [rowWithClickEvidence], error: null });
    const campaigns = await listProjectCampaigns(query.client, projectId);

    expect(
      campaigns[0]?.contentAssets[0]?.trackedLinks[0]?.clickEvidence,
    ).toEqual({
      eligibleRedirects: 1,
      ineligibleAttempts: 1,
      totalAttempts: 2,
      firstObservedAt: "2026-08-10T12:30:00.000Z",
      lastObservedAt: "2026-08-10T12:45:00.000Z",
    });
    expect(
      campaigns[0]?.contentAssets[0]?.trackedLinks[0]?.clickQuality,
    ).toEqual({
      ruleVersion: 1,
      duplicateWindowSeconds: 1800,
      qualifiedClicks: 1,
      duplicateClicks: 0,
      rejectedClicks: 1,
      totalAssessed: 2,
      pendingAssessment: 0,
      firstAssessedAt: "2026-08-10T12:30:01.000Z",
      lastAssessedAt: "2026-08-10T12:45:01.000Z",
    });
    expect(
      campaigns[0]?.contentAssets[0]?.trackedLinks[0]?.anonymousSessions,
    ).toEqual({
      sessions: 1,
      boundClicks: 1,
      firstCreatedAt: "2026-08-10T12:30:02.000Z",
      lastSeenAt: "2026-08-10T12:30:02.000Z",
    });
  });

  it("maps a missing redirect summary to an explicit zero-traffic state", async () => {
    const rowWithoutClickEvidence = {
      ...campaignRow,
      content_assets: campaignRow.content_assets.map((asset) => ({
        ...asset,
        tracked_links: [
          {
            id: "d1000000-0000-4000-8000-000000000002",
            generation_request_id: "d2000000-0000-4000-8000-000000000002",
            destination_url: "https://helios.example.test/start",
            project_tracking_destination_hosts: { revoked_at: null },
            key_version: 1,
            expires_at: "2026-09-10T12:00:00+00:00",
            issued_by: "30000000-0000-4000-8000-000000000001",
            issued_at: "2026-08-10T12:00:00+00:00",
            revoked_at: null,
            revoked_by: null,
            revocation_request_id: null,
            revocation_reason: null,
            tracked_link_click_summaries: null,
            tracked_link_click_quality_summaries: [],
            tracked_link_anonymous_session_summaries: null,
          },
        ],
      })),
    };
    const query = listClient({ data: [rowWithoutClickEvidence], error: null });
    const campaigns = await listProjectCampaigns(query.client, projectId);

    expect(
      campaigns[0]?.contentAssets[0]?.trackedLinks[0]?.clickEvidence,
    ).toEqual({
      eligibleRedirects: 0,
      ineligibleAttempts: 0,
      totalAttempts: 0,
      firstObservedAt: null,
      lastObservedAt: null,
    });
    expect(
      campaigns[0]?.contentAssets[0]?.trackedLinks[0]?.clickQuality,
    ).toEqual({
      ruleVersion: null,
      duplicateWindowSeconds: null,
      qualifiedClicks: 0,
      duplicateClicks: 0,
      rejectedClicks: 0,
      totalAssessed: 0,
      pendingAssessment: 0,
      firstAssessedAt: null,
      lastAssessedAt: null,
    });
    expect(
      campaigns[0]?.contentAssets[0]?.trackedLinks[0]?.anonymousSessions,
    ).toEqual({
      sessions: 0,
      boundClicks: 0,
      firstCreatedAt: null,
      lastSeenAt: null,
    });
  });
});

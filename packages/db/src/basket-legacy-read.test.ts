import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { BasketQueryError, getProjectBasket } from "./index";

const projectId = "20000000-0000-4000-8000-000000000001";
const basketId = "90000000-0000-4000-8000-000000000001";
const scenarioId = "91000000-0000-4000-8000-000000000001";
const planId = "94000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
const optionalPackageColumns = [
  "commercial_detail_revision",
  "commercial_basis",
  "unpaid_reason",
  "channel_ids",
  "delivery_deadline",
  "usage_rights",
  "exclusivity",
];
type ReadError = { code?: string; message?: string };

function fixture(
  options: {
    missingPackages?: string[];
    missingApprovalVersion?: boolean;
    cacheError?: boolean;
    error?: ReadError;
    errorTable?: string;
    repeatError?: boolean;
    malformed?: boolean;
    approvalError?: ReadError;
    stale?: boolean;
  } = {},
) {
  const attempts: {
    table: string;
    columns: string;
    filters: unknown[][];
    order: unknown[][];
    limits: number[];
    singles: number;
  }[] = [];
  const rows: Record<string, unknown> = {
    baskets: {
      id: basketId,
      workspace_id: "10000000-0000-4000-8000-000000000001",
      project_id: projectId,
      name: "Saved plan",
      objective: "Internal test",
      outcome_metric: "qualified_wallets",
      outcome_baseline_units: "0",
      outcome_target_units: "200",
      outcome_currency_code: null,
      created_at: "2026-10-11T12:00:00Z",
      updated_at: "2026-10-11T12:00:00Z",
    },
    basket_scenarios: [
      { id: scenarioId, code: "A", name: "Selected" },
      {
        id: "91000000-0000-4000-8000-000000000002",
        code: "B",
        name: "Alternative",
      },
      {
        id: "91000000-0000-4000-8000-000000000003",
        code: "C",
        name: "Alternative",
      },
    ],
    basket_scenario_packages: [],
    creator_packages: [
      {
        id: "92000000-0000-4000-8000-000000000001",
        creator_id: "40000000-0000-4000-8000-000000000001",
        source_rate_quote_id: null,
        package_label: "Saved terms",
        deliverable_summary: "One thread",
        compensation_lines: [],
        creators: null,
        commercial_detail_revision: options.malformed ? "bad" : 3,
        commercial_basis: "compensated",
        unpaid_reason: null,
        channel_ids: [],
        delivery_deadline: "2026-10-11T18:00:00Z",
        usage_rights: "One week",
        exclusivity: "None",
      },
    ],
    commercial_plan_versions: {
      id: planId,
      scenario_id: scenarioId,
      version: 1,
      approved_by: "30000000-0000-4000-8000-000000000001",
      approved_at: "2026-10-11T12:00:00Z",
      approval_reason: "Reviewed",
      approval_record_version: 2,
      snapshot_hash: hash,
      basket_scenarios: { code: "A", name: "Selected" },
    },
  };
  const missingError = (table: string, column: string) =>
    options.cacheError
      ? {
          code: "PGRST204",
          message: `Could not find the '${column}' column of '${table}' in the schema cache`,
        }
      : { code: "42703", message: `column ${table}.${column} does not exist` };
  const from = vi.fn((table: string) => ({
    select: vi.fn((columns: string) => {
      const attempt = {
        table,
        columns,
        filters: [] as unknown[][],
        order: [] as unknown[][],
        limits: [] as number[],
        singles: 0,
      };
      attempts.push(attempt);
      const selected = (column: string) =>
        columns.split(/[\s,]+/).includes(column);
      const result = () => {
        if (
          table === (options.errorTable ?? "creator_packages") &&
          options.error
        ) {
          return { data: null, error: options.error };
        }
        const missing =
          table === "creator_packages"
            ? (options.missingPackages ?? [])
            : table === "commercial_plan_versions" &&
                options.missingApprovalVersion
              ? ["approval_record_version"]
              : [];
        const absent = missing.find(selected);
        if (absent || (options.repeatError && missing[0])) {
          return {
            data: null,
            error: missingError(table, absent ?? missing[0]!),
          };
        }
        const omitMissing = (row: unknown) =>
          Object.fromEntries(
            Object.entries(row as object).filter(
              ([key]) => !missing.includes(key),
            ),
          );
        const data = rows[table];
        return {
          data: Array.isArray(data) ? data.map(omitMissing) : omitMissing(data),
          error: null,
        };
      };
      const query = {
        eq: vi.fn((...args: unknown[]) => {
          attempt.filters.push(args);
          return query;
        }),
        order: vi.fn((...args: unknown[]) => {
          attempt.order.push(args);
          return query;
        }),
        limit: vi.fn((value: number) => {
          attempt.limits.push(value);
          return query;
        }),
        maybeSingle: vi.fn(async () => {
          attempt.singles++;
          return result();
        }),
        then: (
          resolve: (value: ReturnType<typeof result>) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(result()).then(resolve, reject),
      };
      return query;
    }),
  }));
  const rpc = vi.fn().mockResolvedValue({
    data: options.stale ? "b".repeat(64) : hash,
    error: options.approvalError ?? null,
  });
  return { client: { from, rpc } as unknown as SupabaseClient, attempts, rpc };
}

describe("BSK-02 / BSK-09 legacy saved-plan reads", () => {
  it("reads fully legacy columns with bounded scoped PostgreSQL retries", async () => {
    const f = fixture({
      missingPackages: optionalPackageColumns,
      missingApprovalVersion: true,
    });
    const basket = await getProjectBasket(f.client, projectId, basketId);
    expect(basket?.outcomeProfile).toEqual({
      metric: "qualified_wallets",
      baselineUnits: "0",
      targetUnits: "200",
      currencyCode: null,
    });
    expect(basket?.packages[0]?.commercialDetail).toBeUndefined();
    expect(basket?.latestApprovalIsCurrent).toBe(true);
    expect(
      f.attempts.filter((a) => a.table === "creator_packages"),
    ).toHaveLength(8);
    expect(
      f.attempts.filter((a) => a.table === "commercial_plan_versions"),
    ).toHaveLength(2);
    for (const a of f.attempts.filter((a) =>
      ["creator_packages", "commercial_plan_versions"].includes(a.table),
    )) {
      expect(a.filters).toEqual([
        ["project_id", projectId],
        ["basket_id", basketId],
      ]);
      if (a.table === "commercial_plan_versions") {
        expect(a.order).toEqual([["version", { ascending: false }]]);
        expect(a.limits).toEqual([1]);
        expect(a.singles).toBe(1);
      }
    }
    expect(f.rpc).toHaveBeenCalledWith("get_basket_scenario_commercial_hash", {
      target_project_id: projectId,
      target_basket_id: basketId,
      target_scenario_id: scenarioId,
    });
  });

  it.each(["creator_packages", "commercial_plan_versions"])(
    "does not downgrade %s on a possibly stale schema cache",
    async (table) => {
      const f = fixture({
        missingPackages:
          table === "creator_packages" ? optionalPackageColumns : [],
        missingApprovalVersion: table === "commercial_plan_versions",
        cacheError: true,
      });
      await expect(
        getProjectBasket(f.client, projectId, basketId),
      ).rejects.toMatchObject({
        name: "BasketQueryError",
        code: "PGRST204",
      });
      expect(f.attempts.filter((a) => a.table === table)).toHaveLength(1);
      expect(f.rpc).not.toHaveBeenCalled();
    },
  );

  it("rejects modern terms without their revision instead of silently hiding them", async () => {
    const f = fixture({ missingPackages: ["commercial_detail_revision"] });
    await expect(
      getProjectBasket(f.client, projectId, basketId),
    ).rejects.toThrow("Package commercial details could not be verified.");
    expect(
      f.attempts.filter((a) => a.table === "creator_packages"),
    ).toHaveLength(2);
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("removes only the missing field, retaining modern terms and real V2 approval", async () => {
    const f = fixture({ missingPackages: ["unpaid_reason"] });
    const basket = await getProjectBasket(f.client, projectId, basketId);
    const attempts = f.attempts.filter((a) => a.table === "creator_packages");
    expect(attempts).toHaveLength(2);
    for (const column of optionalPackageColumns.filter(
      (c) => c !== "unpaid_reason",
    ))
      expect(attempts[1]!.columns).toContain(column);
    expect(attempts[1]!.columns).not.toContain("unpaid_reason");
    expect(basket?.packages[0]?.commercialDetail).toMatchObject({
      usageRights: "One week",
      exclusivity: "None",
      deliveryDeadline: "2026-10-11T18:00:00Z",
    });
    expect(basket?.latestApproval?.approvalRecordVersion).toBe(2);
    expect(f.rpc).toHaveBeenCalledWith("get_selected_basket_commercial_hash", {
      target_project_id: projectId,
      target_basket_id: basketId,
      target_plan_id: planId,
    });
  });

  it("makes no compatibility retry for a modern schema", async () => {
    const f = fixture();
    await getProjectBasket(f.client, projectId, basketId);
    expect(f.attempts).toHaveLength(5);
  });

  it.each([
    {
      code: "42501",
      message: "column creator_packages.usage_rights does not exist",
    },
    { code: "PGRST301", message: "JWT expired" },
    { code: "FETCH_ERROR", message: "Failed to fetch" },
    {
      code: "42703",
      message: "column creator_packages.package_label does not exist",
    },
    { code: "42703", message: "column creators.usage_rights does not exist" },
    {
      code: "42703",
      message:
        "column creator_packages.usage_rights does not exist HINT other failure",
    },
    { code: "42703", message: "" },
    { message: "column creator_packages.usage_rights does not exist" },
    {
      code: "PGRST204",
      message:
        "Could not find the 'usage_rights' column of 'creators' in the schema cache",
    },
  ])(
    "does not retry unrelated/permission/network/malformed error $code: $message",
    async (error) => {
      const f = fixture({ error });
      await expect(
        getProjectBasket(f.client, projectId, basketId),
      ).rejects.toMatchObject({ name: "BasketQueryError", code: error.code });
      expect(
        f.attempts.filter((a) => a.table === "creator_packages"),
      ).toHaveLength(1);
      expect(f.rpc).not.toHaveBeenCalled();
    },
  );

  it("stops if an omitted column is reported missing again", async () => {
    const f = fixture({ missingPackages: ["usage_rights"], repeatError: true });
    await expect(
      getProjectBasket(f.client, projectId, basketId),
    ).rejects.toBeInstanceOf(BasketQueryError);
    expect(
      f.attempts.filter((a) => a.table === "creator_packages"),
    ).toHaveLength(2);
  });

  it("never downgrades approval after a permission failure mentioning the version column", async () => {
    const f = fixture({
      errorTable: "commercial_plan_versions",
      error: {
        code: "42501",
        message:
          "column commercial_plan_versions.approval_record_version does not exist",
      },
    });
    await expect(
      getProjectBasket(f.client, projectId, basketId),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      f.attempts.filter((a) => a.table === "commercial_plan_versions"),
    ).toHaveLength(1);
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("preserves schema validation after a compatibility retry", async () => {
    const f = fixture({ missingPackages: ["unpaid_reason"], malformed: true });
    await expect(
      getProjectBasket(f.client, projectId, basketId),
    ).rejects.toThrow();
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("still marks a legacy approval stale on hash mismatch", async () => {
    const f = fixture({ missingApprovalVersion: true, stale: true });
    expect(
      (await getProjectBasket(f.client, projectId, basketId))
        ?.latestApprovalIsCurrent,
    ).toBe(false);
  });

  it("does not swallow approval verification failures", async () => {
    const f = fixture({
      missingApprovalVersion: true,
      approvalError: { code: "42501" },
    });
    await expect(
      getProjectBasket(f.client, projectId, basketId),
    ).rejects.toMatchObject({ code: "42501" });
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
});

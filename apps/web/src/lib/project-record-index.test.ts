import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  loadProjectRecordIndex,
  parseRecordPage,
} from "./project-record-index";

const record = {
  id: "a1000000-0000-4000-8000-000000000001",
  name: "Launch",
  updated_at: "2026-09-08T10:00:00+00:00",
  status: "approved",
};
function queryFixture(data: unknown = [record], error: unknown = null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn().mockResolvedValue({ data, error }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  return { query, from, client: { from } as unknown as SupabaseClient };
}
describe("project record selection", () => {
  it("loads only scoped summaries with stable pagination", async () => {
    const { query, from, client } = queryFixture(
      Array.from({ length: 26 }, () => record),
    );
    const result = await loadProjectRecordIndex(
      client,
      "project",
      "workspace",
      "campaigns",
      2,
    );
    expect(from).toHaveBeenCalledWith("campaigns");
    expect(query.select).toHaveBeenCalledWith("id, name, updated_at, status");
    expect(query.eq).toHaveBeenCalledWith("project_id", "project");
    expect(query.eq).toHaveBeenCalledWith("workspace_id", "workspace");
    expect(query.order.mock.calls).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(query.range).toHaveBeenCalledWith(25, 50);
    expect(result).toMatchObject({ kind: "ready", hasNext: true });
    if (result.kind === "ready") expect(result.records).toHaveLength(25);
  });
  it("does not classify inaccessible or failed queries as an empty project", async () => {
    const denied = queryFixture(null, { code: "42501" });
    expect(
      await loadProjectRecordIndex(denied.client, "p", "w", "baskets", 1),
    ).toEqual({ kind: "permission" });
    const broken = queryFixture(null, { code: "08006" });
    await expect(
      loadProjectRecordIndex(broken.client, "p", "w", "baskets", 1),
    ).rejects.toThrow("could not be loaded");
    const empty = queryFixture([]);
    expect(
      await loadProjectRecordIndex(empty.client, "p", "w", "baskets", 1),
    ).toEqual({ kind: "ready", records: [], hasNext: false });
  });
  it("accepts only unambiguous positive page numbers", () => {
    expect(parseRecordPage(undefined)).toBe(1);
    expect(parseRecordPage("2")).toBe(2);
    for (const value of ["0", "-1", "1.5", "NaN", "01", "1000000", ["1", "2"]])
      expect(parseRecordPage(value)).toBeNull();
  });
});

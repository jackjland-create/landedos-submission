import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export type RecordSection = "baskets" | "campaigns";
export const recordPageSize = 25;
const summary = z.object({
  id: z.uuid(),
  name: z.string(),
  updated_at: z.iso.datetime({ offset: true }),
  status: z
    .enum(["draft", "approved", "live", "finalizing", "finalized"])
    .optional(),
});
export type ProjectRecordSummary = z.infer<typeof summary>;

export function parseRecordPage(value: string | string[] | undefined) {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^[1-9]\d{0,5}$/.test(value)) return null;
  return Number(value);
}

export async function loadProjectRecordIndex(
  client: SupabaseClient,
  projectId: string,
  workspaceId: string,
  section: RecordSection,
  page: number,
) {
  const offset = (page - 1) * recordPageSize;
  const result = await client
    .from(section)
    .select(
      section === "campaigns"
        ? "id, name, updated_at, status"
        : "id, name, updated_at",
    )
    .eq("project_id", projectId)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + recordPageSize);
  if (result.error) {
    if (result.error.code === "42501") return { kind: "permission" as const };
    throw new Error(`The ${section} list could not be loaded. Retry the view.`);
  }
  const records = z.array(summary).parse(result.data ?? []);
  return {
    kind: "ready" as const,
    records: records.slice(0, recordPageSize),
    hasNext: records.length > recordPageSize,
  };
}

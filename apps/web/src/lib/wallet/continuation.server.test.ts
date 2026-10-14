import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { context } = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("./measurement-context.server", () => ({
  readWalletMeasurementRuleContext: context,
}));
import { readHostedContinuation } from "./continuation.server";

const id = (n: number) =>
  `a1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = {
  workspace_id: id(1),
  project_id: id(2),
  campaign_id: id(3),
  creator_id: id(4),
  content_asset_id: id(5),
};
const now = Date.parse("2026-10-10T12:00:00Z");
const expiry = "2026-10-10T13:00:00Z";
function fixture(
  change: {
    session?: object;
    link?: object;
    host?: object;
    failure?: string;
  } = {},
) {
  const rows: Record<string, unknown> = {
    anonymous_sessions: {
      ...scope,
      id: id(6),
      tracked_link_id: id(7),
      expires_at: expiry,
      ...change.session,
    },
    tracked_links: {
      ...scope,
      id: id(7),
      destination_host_id: id(8),
      destination_url: "https://brand.example/signup?campaign=autumn#start",
      expires_at: expiry,
      revoked_at: null,
      ...change.link,
    },
    project_tracking_destination_hosts: {
      id: id(8),
      workspace_id: id(1),
      project_id: id(2),
      hostname: "brand.example",
      revoked_at: null,
      ...change.host,
    },
  };
  const eq = vi.fn();
  const from = vi.fn((table: string) => {
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => {
        eq(table, key, value);
        return query;
      },
      maybeSingle: async () => ({
        data: rows[table],
        error: change.failure === table ? { code: "failed" } : null,
      }),
    };
    return query;
  });
  return { client: { from } as unknown as SupabaseClient, from, eq };
}
beforeEach(() => {
  context.mockReset();
  context.mockResolvedValue({ ruleVersionId: id(9) });
});
describe("hosted onward destination", () => {
  it("returns only the retained approved destination and scopes each read", async () => {
    const { client, eq } = fixture();
    expect(
      await readHostedContinuation(
        client,
        id(6),
        "https://landed.example",
        now,
      ),
    ).toEqual({
      url: "https://brand.example/signup?campaign=autumn#start",
      hostname: "brand.example",
    });
    expect(context).toHaveBeenCalledWith(client, id(6));
    for (const [key, value] of Object.entries(scope))
      expect(eq).toHaveBeenCalledWith("tracked_links", key, value);
    expect(eq).toHaveBeenCalledWith(
      "project_tracking_destination_hosts",
      "id",
      id(8),
    );
  });
  it("does not read a destination without a valid exact measurement context", async () => {
    const { client, from } = fixture();
    context.mockResolvedValue(null);
    expect(
      await readHostedContinuation(
        client,
        id(6),
        "https://landed.example",
        now,
      ),
    ).toBeNull();
    expect(from).not.toHaveBeenCalled();
    context.mockClear();
    expect(
      await readHostedContinuation(
        client,
        "invalid",
        "https://landed.example",
        now,
      ),
    ).toBeNull();
    expect(context).not.toHaveBeenCalled();
  });
  it.each([
    { session: { id: id(40) } },
    { session: { expires_at: "2026-10-10T12:00:00Z" } },
    { link: { expires_at: "2026-10-10T12:00:00Z" } },
    { link: { revoked_at: expiry } },
    { link: { project_id: id(40) } },
    { link: { workspace_id: id(40) } },
    { link: { creator_id: id(40) } },
    { link: { content_asset_id: id(40) } },
    { link: { campaign_id: id(40) } },
    { link: { id: id(40) } },
    { host: { id: id(40) } },
    { host: { workspace_id: id(40) } },
    { host: { project_id: id(40) } },
    { host: { hostname: "other.example" } },
    { host: { revoked_at: expiry } },
    { link: { destination_host_id: null } },
    { link: { destination_url: "http://brand.example" } },
    { link: { destination_url: "https://user:password@brand.example" } },
    { link: { destination_url: "https://brand.example\\@evil.example" } },
    { link: { destination_url: "https://brand.example/\npath" } },
    {
      link: { destination_url: "https://landed.example/measure" },
      host: { hostname: "landed.example" },
    },
  ])(
    "fails closed for invalid, cross-scope or inactive evidence: %j",
    async (change) => {
      const { client } = fixture(change);
      expect(
        await readHostedContinuation(
          client,
          id(6),
          "https://landed.example",
          now,
        ),
      ).toBeNull();
    },
  );
  it.each([
    "anonymous_sessions",
    "tracked_links",
    "project_tracking_destination_hosts",
  ])("does not convert %s read failure into a destination", async (failure) => {
    await expect(
      readHostedContinuation(
        fixture({ failure }).client,
        id(6),
        "https://landed.example",
        now,
      ),
    ).rejects.toThrow("could not be read");
  });
});

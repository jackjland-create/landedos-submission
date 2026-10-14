import "server-only";

import { trackedLinkDestinationSchema } from "@landed/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { project } from "@/lib/demo-data";
import {
  buildSignedTrackedLink,
  getTrackedLinkApplicationOrigin,
  getTrackedLinkKeyring,
} from "@/lib/tracking/signing.server";
import { runLocalDevnetAction } from "./devnet-campaign-runtime.server";

const handoffSchema = z.object({
  campaignId: z.uuid(),
  status: z.enum(["blocked", "ready", "live"]),
  brief: z.object({ status: z.string() }).nullable(),
  blockers: z.array(z.string()),
  destination: z.object({
    url: trackedLinkDestinationSchema,
    capabilityExpiresAt: z.iso.datetime({ offset: true }),
  }),
  assets: z.array(
    z.object({
      contentAssetId: z.uuid(),
      creatorId: z.uuid(),
      trackedLinkId: z.uuid().nullable(),
    }),
  ),
});

function readyAsset(
  handoff: z.infer<typeof handoffSchema>,
  input: { campaignId: string; contentAssetId: string },
) {
  if (
    handoff.campaignId !== input.campaignId ||
    handoff.status === "blocked" ||
    handoff.blockers.length > 0 ||
    handoff.brief?.status !== "approved" ||
    new Date(handoff.destination.capabilityExpiresAt).getTime() <= Date.now()
  )
    throw new Error("The participant link is not ready to share.");
  const asset = handoff.assets.find(
    (entry) => entry.contentAssetId === input.contentAssetId,
  );
  if (!asset?.trackedLinkId)
    throw new Error("The participant link is not issued.");
  return asset;
}

const linkSchema = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  project_id: z.uuid(),
  campaign_id: z.uuid(),
  content_asset_id: z.uuid(),
  creator_id: z.uuid(),
  destination_host_id: z.uuid(),
  destination_url: trackedLinkDestinationSchema,
  expires_at: z.iso.datetime({ offset: true }),
  key_version: z.number().int().positive(),
  revoked_at: z.iso.datetime({ offset: true }).nullable(),
});

/** Local-only: current manager authority and exact retained link are re-read before signing. */
export async function readLocalDevnetSignedLink(
  client: SupabaseClient,
  input: { campaignId: string; contentAssetId: string },
) {
  const handoff = handoffSchema.parse(
    await runLocalDevnetAction(client, {
      action: "readActivation",
      campaignId: input.campaignId,
    }),
  );
  const asset = readyAsset(handoff, input);

  const { data, error } = await client
    .from("tracked_links")
    .select(
      "id, workspace_id, project_id, campaign_id, content_asset_id, creator_id, destination_host_id, destination_url, expires_at, key_version, revoked_at",
    )
    .eq("id", asset.trackedLinkId)
    .eq("workspace_id", project.workspaceId)
    .eq("project_id", project.databaseId)
    .eq("campaign_id", input.campaignId)
    .eq("content_asset_id", input.contentAssetId)
    .maybeSingle();
  if (error)
    throw new Error("The retained participant link could not be read.");
  const parsed = linkSchema.safeParse(data);
  if (!parsed.success)
    throw new Error("The retained participant link is unavailable.");
  const link = parsed.data;
  if (
    link.id !== asset.trackedLinkId ||
    link.workspace_id !== project.workspaceId ||
    link.project_id !== project.databaseId ||
    link.campaign_id !== input.campaignId ||
    link.content_asset_id !== input.contentAssetId ||
    link.creator_id !== asset.creatorId ||
    link.revoked_at !== null ||
    link.destination_url !== handoff.destination.url ||
    new Date(link.expires_at).getTime() <= Date.now()
  )
    throw new Error("The retained participant link is no longer current.");

  const host = await client
    .from("project_tracking_destination_hosts")
    .select("id, hostname, revoked_at")
    .eq("id", link.destination_host_id)
    .eq("workspace_id", project.workspaceId)
    .eq("project_id", project.databaseId)
    .maybeSingle();
  if (
    host.error ||
    !host.data ||
    host.data.id !== link.destination_host_id ||
    host.data.revoked_at !== null ||
    host.data.hostname !== new URL(link.destination_url).hostname
  )
    throw new Error("The participant destination is no longer approved.");

  const signed = await buildSignedTrackedLink({
    origin: getTrackedLinkApplicationOrigin(),
    keyring: getTrackedLinkKeyring(),
    payload: {
      schemaVersion: 1,
      linkId: link.id,
      campaignId: input.campaignId,
      creatorId: link.creator_id,
      contentAssetId: link.content_asset_id,
      expiresAt: link.expires_at,
      keyVersion: link.key_version,
    },
  });
  // Signing does not release the URL. Recheck authority after all awaited reads
  // and signing so revocation, demotion or expiry during them fails closed.
  const currentHandoff = handoffSchema.parse(
    await runLocalDevnetAction(client, {
      action: "readActivation",
      campaignId: input.campaignId,
    }),
  );
  const currentAsset = readyAsset(currentHandoff, input);
  if (
    currentAsset.trackedLinkId !== link.id ||
    currentAsset.creatorId !== link.creator_id ||
    currentHandoff.destination.url !== link.destination_url ||
    new Date(link.expires_at).getTime() <= Date.now()
  )
    throw new Error("The retained participant link is no longer current.");
  return { url: signed.url, expiresAt: link.expires_at };
}
